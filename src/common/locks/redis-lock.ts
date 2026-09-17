import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Command, type Redis } from 'ioredis';
import type { LockLease, LockResult } from './lock.types';

export interface RedisLockOptions {
  ttlMs?: number;
  waitMs?: number;
  signal?: AbortSignal;
}

export interface RedisLockLease extends LockLease {
  readonly signal: AbortSignal;
}

export class RedisLockLostError extends Error {
  readonly name = 'RedisLockLostError';
}

const LOCK_POLICY = Object.freeze({
  ttlMs: 30_000,
  retryMs: 50,
  commandTimeoutMs: 2000,
  maxTimerMs: 2_147_483_647,
});
const CHECK_OWNER =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return 1 end return 0';
const RENEW_OWNER =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0';
const RELEASE_OWNER =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0';

/**
 * 对锁命令设置独立响应期限，使用已禁止离线排队与断线重发的全局连接，防止过期请求重新获取锁。
 * @param redis - 全局锁服务持有的专用 Redis 连接。
 * @param name - 原子锁命令名称。
 * @param args - 命令参数，包含业务键和本次随机所有权凭证。
 * @param timeoutMs - 本次命令允许等待响应的毫秒数。
 * @returns Redis 的原始命令回执。
 * @throws 连接未就绪、命令超时或 Redis 拒绝执行时拒绝返回成功。
 */
async function lockCommand(
  redis: Redis,
  name: string,
  args: Array<string | number>,
  timeoutMs: number,
): Promise<unknown> {
  if (redis.status !== 'ready') throw new Error('Redis锁连接未就绪');
  const command = new Command(name, args, {
    replyEncoding: 'utf8',
    keyPrefix: redis.options.keyPrefix,
  });
  command.setTimeout(timeoutMs);
  try {
    redis.sendCommand(command);
  } catch (error) {
    command.reject(error as Error);
  }
  return command.promise;
}

/**
 * 在竞争重试间等待并响应调用方取消，结束时移除监听器，避免等待中的锁调用遗留资源。
 * @param milliseconds - 不超过剩余竞争期限的等待毫秒数。
 * @param signal - 调用方可选的取消信号。
 * @returns 等待结束后完成，取消时保留原始取消原因。
 */
function waitForRetry(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

class RedisLeaseController {
  private readonly abort = new AbortController();
  private renewalTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private renewal?: Promise<void>;
  private active = true;
  private readonly callerAbort = () =>
    this.lose(
      new RedisLockLostError('Redis锁调用已取消', {
        cause: this.callerSignal?.reason,
      }),
    );
  loss?: RedisLockLostError;

  constructor(
    private readonly redis: Redis,
    readonly name: string,
    private readonly token: string,
    private readonly ttlMs: number,
    private readonly commandTimeoutMs: number,
    private expiresAt: number,
    private readonly callerSignal?: AbortSignal,
  ) {}

  /**
   * 启动续期和本地单调时钟看门狗，返回的租约不能被调用方改写。
   * @returns 包含所有权核对和失锁取消信号的只读租约。
   */
  start(): RedisLockLease {
    this.callerSignal?.addEventListener('abort', this.callerAbort, {
      once: true,
    });
    if (this.callerSignal?.aborted) this.callerAbort();
    if (!this.loss) this.schedule();
    return Object.freeze({
      name: this.name,
      signal: this.abort.signal,
      isOwned: () => this.isOwned(),
    });
  }

  /**
   * 核对本次凭证仍在 Redis 中持有资源，过期或已结束的租约不会访问连接或恢复有效性。
   * @returns 只有本地期限、活动状态及 Redis 凭证都有效时为真。
   */
  private async isOwned(): Promise<boolean> {
    if (!this.active || this.loss) return false;
    if (performance.now() >= this.expiresAt) {
      this.lose(new RedisLockLostError('Redis锁租约已过期'));
      return false;
    }
    try {
      const result = await lockCommand(
        this.redis,
        'eval',
        [CHECK_OWNER, 1, this.name, this.token],
        this.commandTimeoutMs,
      );
      if (!this.active || this.loss) return false;
      if (result === 1 && performance.now() < this.expiresAt) return true;
      this.lose(new RedisLockLostError('Redis锁所有权已丢失'));
    } catch (error) {
      this.lose(
        new RedisLockLostError('Redis锁所有权无法确认', { cause: error }),
      );
    }
    return false;
  }

  /** 在下一次续期之前保留独立到期通知，事件循环迟到时也不能把旧租约当成有效。 */
  private schedule(): void {
    const remaining = this.expiresAt - performance.now();
    if (remaining <= 0) {
      this.lose(new RedisLockLostError('Redis锁租约已过期'));
      return;
    }
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => this.lose(new RedisLockLostError('Redis锁租约已过期')),
      remaining,
    );
    this.renewalTimer = setTimeout(
      () => {
        this.renewal = this.renew();
      },
      Math.min(Math.floor(this.ttlMs / 3), remaining),
    );
    this.expiryTimer.unref();
    this.renewalTimer.unref();
  }

  /** 仅续期当前凭证，续期失败立即通知调用方，禁止并行心跳或在结束后重新启动计时器。 */
  private async renew(): Promise<void> {
    if (!this.active || this.loss) return;
    const startedAt = performance.now();
    if (startedAt >= this.expiresAt) {
      this.lose(new RedisLockLostError('Redis锁在续期前已过期'));
      return;
    }
    try {
      const result = await lockCommand(
        this.redis,
        'eval',
        [RENEW_OWNER, 1, this.name, this.token, this.ttlMs],
        Math.max(
          1,
          Math.min(this.commandTimeoutMs, this.expiresAt - startedAt),
        ),
      );
      if (!this.active || this.loss) return;
      if (result !== 1 || performance.now() >= this.expiresAt) {
        this.lose(new RedisLockLostError('Redis锁续期失败'));
        return;
      }
      this.expiresAt = startedAt + this.ttlMs;
      this.schedule();
    } catch (error) {
      this.lose(
        new RedisLockLostError('Redis锁续期无法确认', { cause: error }),
      );
    }
  }

  /**
   * 保留首个失锁原因并撤销所有计时器，调用方通过信号停止后续副作用。
   * @param error - 已确认的失锁、超时或调用方取消原因。
   */
  private lose(error: RedisLockLostError): void {
    if (!this.active || this.loss) return;
    this.loss = error;
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.abort.abort(error);
  }

  /** 停止计时并等待已发送的续期结束，确保释放之后不会再出现延迟续期。 */
  async stop(): Promise<void> {
    if (!this.loss && performance.now() >= this.expiresAt)
      this.lose(new RedisLockLostError('Redis锁在操作完成前已过期'));
    this.active = false;
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.callerSignal?.removeEventListener('abort', this.callerAbort);
    await this.renewal;
  }

  /**
   * 以同一随机凭证原子释放资源，其他拥有者的键不会被删除。
   * @returns 当前凭证被删除时为真，已经过期或换主时为假。
   * @throws Redis 释放响应未知时拒绝确认清理成功。
   */
  async release(): Promise<boolean> {
    const result = await lockCommand(
      this.redis,
      'eval',
      [RELEASE_OWNER, 1, this.name, this.token],
      this.commandTimeoutMs,
    );
    if (result === 1) return true;
    if (result === 0) return false;
    throw new Error('Redis锁释放结果无法确认');
  }
}

/**
 * 在 API 全局管理 Redis 互斥租约，竞争有界、心跳串行、失锁通知与凭证释放均由公共能力负责。
 * @param redis - 禁止离线排队及未完成命令重发的专用连接。
 * @param name - 业务资源键，由专用连接统一添加全局前缀。
 * @param options - 租约期限、竞争等待和调用方取消信号。
 * @param action - 获锁后执行的操作，收到租约取消信号后应结束后续副作用。
 * @returns 竞争超时或操作结果；失锁时不返回业务成功。
 * @throws 参数或连接策略非法、连接失败、调用取消、租约丢失或业务失败时拒绝完成。
 */
export async function withRedisLock<T>(
  redis: Redis,
  name: string,
  options: RedisLockOptions,
  action: (lease: RedisLockLease) => Promise<T>,
): Promise<LockResult<T>> {
  const ttlMs = options.ttlMs ?? LOCK_POLICY.ttlMs;
  const waitMs = options.waitMs ?? 0;
  if (typeof name !== 'string' || !name || name.length > 512)
    throw new Error('Redis锁资源键需要1至512个字符');
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 100 ||
    ttlMs > LOCK_POLICY.maxTimerMs
  )
    throw new Error('Redis锁租约毫秒数超出允许范围');
  if (
    !Number.isSafeInteger(waitMs) ||
    waitMs < 0 ||
    waitMs > LOCK_POLICY.maxTimerMs
  )
    throw new Error('Redis锁等待毫秒数超出允许范围');
  if (
    redis.options.enableOfflineQueue !== false ||
    redis.options.autoResendUnfulfilledCommands !== false
  )
    throw new Error('Redis锁连接必须禁止离线排队和未完成命令重发');
  const token = randomUUID();
  const commandTimeoutMs = Math.min(
    LOCK_POLICY.commandTimeoutMs,
    Math.floor(ttlMs / 3),
  );
  const waitingUntil = performance.now() + waitMs;
  let expiresAt = 0;
  let attempted = false;
  while (true) {
    options.signal?.throwIfAborted();
    if (attempted && performance.now() >= waitingUntil)
      return { acquired: false };
    attempted = true;
    const startedAt = performance.now();
    let acquired: unknown;
    try {
      let budget = commandTimeoutMs;
      if (waitMs > 0)
        budget = Math.max(1, Math.min(budget, waitingUntil - startedAt));
      acquired = await lockCommand(
        redis,
        'set',
        [name, token, 'PX', ttlMs, 'NX'],
        budget,
      );
      if (acquired !== 'OK' && acquired !== null)
        throw new Error('Redis锁获取结果无法确认');
    } catch (error) {
      try {
        await lockCommand(
          redis,
          'eval',
          [RELEASE_OWNER, 1, name, token],
          commandTimeoutMs,
        );
      } catch {
        /* 连接失效时由固定 TTL 回收未知结果的占位；不运行未确认获锁的操作。 */
      }
      throw error;
    }
    if (acquired === 'OK') {
      expiresAt = startedAt + ttlMs;
      break;
    }
    options.signal?.throwIfAborted();
    const remaining = waitingUntil - performance.now();
    if (remaining <= 0) return { acquired: false };
    await waitForRetry(
      Math.min(LOCK_POLICY.retryMs, remaining),
      options.signal,
    );
  }
  const controller = new RedisLeaseController(
    redis,
    name,
    token,
    ttlMs,
    commandTimeoutMs,
    expiresAt,
    options.signal,
  );
  const lease = controller.start();
  let value: T;
  const errors: unknown[] = [];
  try {
    lease.signal.throwIfAborted();
    value = await action(lease);
  } catch (error) {
    errors.push(error);
  }
  await controller.stop();
  if (controller.loss && !errors.includes(controller.loss))
    errors.push(controller.loss);
  try {
    if (!(await controller.release()) && !controller.loss)
      errors.push(new RedisLockLostError('Redis锁在操作完成前已丢失'));
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 1)
    throw new AggregateError(errors, 'Redis锁操作与清理存在失败', {
      cause: errors[0],
    });
  if (errors.length) throw errors[0];
  return { acquired: true, value };
}
