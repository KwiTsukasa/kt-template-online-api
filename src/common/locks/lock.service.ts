import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type Redis from 'ioredis';
import { withDatabaseLock } from './database-lock';
import type { LockLease, LockResult } from './lock.types';
import {
  withRedisLock,
  type RedisLockLease,
  type RedisLockOptions,
} from './redis-lock';

@Injectable()
export class LockService implements OnModuleDestroy {
  private readonly redisClient: Redis;
  private readonly shutdown = new AbortController();
  private readonly running = new Set<Promise<unknown>>();
  private connecting?: Promise<void>;

  constructor(
    private readonly database: DataSource,
    @InjectRedis() redis: Redis,
  ) {
    this.redisClient = redis.duplicate({
      lazyConnect: true,
      keyPrefix: 'kt:locks:',
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
      retryStrategy: null,
      connectTimeout: 2000,
    });
    this.redisClient.on('error', () => undefined);
  }

  /**
   * 从全局服务取得数据库资源锁，业务只声明锁键、等待策略及受保护操作。
   * @param name - 已确定隔离边界的数据库资源键。
   * @param waitSeconds - 获取锁时允许等待的秒数。
   * @param action - 使用独占连接管理器及所有权核对能力执行的业务操作。
   * @returns 繁忙状态或操作结果。
   * @throws 服务关闭、数据库状态未知或业务失败时拒绝完成。
   */
  async withDatabase<T>(
    name: string,
    waitSeconds: number,
    action: (manager: EntityManager, lease: LockLease) => Promise<T>,
  ): Promise<LockResult<T>> {
    this.shutdown.signal.throwIfAborted();
    return this.track(
      withDatabaseLock(this.database, name, waitSeconds, action),
    );
  }

  /**
   * 复用全局专用连接执行 Redis 锁操作，调用方取消与应用关闭均传递给当前租约。
   * @param name - 由全局前缀隔离的业务资源键。
   * @param options - 租约期限、竞争等待与业务取消信号。
   * @param action - 获锁后的业务操作，收到失锁信号后停止后续副作用。
   * @returns 繁忙状态或操作结果。
   * @throws 连接不可用、租约丢失、调用取消或业务失败时拒绝完成。
   */
  async withRedis<T>(
    name: string,
    options: RedisLockOptions,
    action: (lease: RedisLockLease) => Promise<T>,
  ): Promise<LockResult<T>> {
    this.shutdown.signal.throwIfAborted();
    await this.ensureRedisReady();
    const signals = [this.shutdown.signal];
    if (options.signal) signals.push(options.signal);
    return this.track(
      withRedisLock(
        this.redisClient,
        name,
        { ...options, signal: AbortSignal.any(signals) },
        action,
      ),
    );
  }

  /**
   * 将同一时刻的连接请求合并，连接失败后允许后续调用显式重试，不离线缓存锁命令。
   * @throws 连接正处于不可恢复状态或本次连接失败时拒绝发起锁操作。
   */
  private async ensureRedisReady(): Promise<void> {
    if (this.redisClient.status === 'ready') return;
    if (!this.connecting) {
      if (!['wait', 'end'].includes(this.redisClient.status))
        throw new Error('Redis锁连接不可用');
      this.connecting = this.redisClient
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connecting = undefined;
        });
    }
    await this.connecting;
  }

  /**
   * 跟踪已发起的锁操作，应用退出时等待其释放完成，失败同样移除跟踪记录。
   * @param operation - 已交给全局锁能力执行的操作。
   * @returns 原始操作结果，不吞掉业务或清理错误。
   */
  private async track<T>(operation: Promise<T>): Promise<T> {
    this.running.add(operation);
    try {
      return await operation;
    } finally {
      this.running.delete(operation);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort(new Error('API锁服务正在关闭'));
    await Promise.allSettled([...this.running]);
    this.redisClient.disconnect();
  }
}
