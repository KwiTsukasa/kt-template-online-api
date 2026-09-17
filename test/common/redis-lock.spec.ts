import type { Command, Redis } from 'ioredis';
import {
  RedisLockLostError,
  withRedisLock,
  type RedisLockLease,
} from '@/common/locks/redis-lock';

jest.mock('node:perf_hooks', () => ({
  performance: { now: () => Date.now() },
}));

const settle = setImmediate;
const advance = async (milliseconds: number) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 10) {
    jest.advanceTimersByTime(Math.min(10, milliseconds - elapsed));
    await new Promise<void>((resolve) => settle(resolve));
  }
};

const pendingReply = Symbol('pending');
const fixture = (reply?: (command: Command) => unknown) => {
  const commands: Command[] = [];
  const client = {
    status: 'ready',
    options: {
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    },
    sendCommand: jest.fn((command: Command) => {
      commands.push(command);
      let result: unknown = 1;
      if (command.name === 'set') result = 'OK';
      if (reply) result = reply(command);
      if (result instanceof Error) command.reject(result);
      else if (result !== pendingReply) command.resolve(result);
      return command.promise;
    }),
  };
  return { client, redis: client as unknown as Redis, commands };
};
const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
const onAbort = (lease: RedisLockLease) =>
  new Promise<void>((_resolve, reject) => {
    lease.signal.addEventListener('abort', () => reject(lease.signal.reason), {
      once: true,
    });
  });

describe('API全局Redis锁', () => {
  beforeEach(() => jest.useFakeTimers({ now: 0 }));
  afterEach(() => jest.useRealTimers());

  it('使用随机凭证原子获取和释放，结束后租约失效且计时器清空', async () => {
    const { redis, commands } = fixture();
    let lease: RedisLockLease;
    expect(
      await withRedisLock(
        redis,
        'resource',
        { ttlMs: 300 },
        async (current) => {
          lease = current;
          expect(await current.isOwned()).toBe(true);
          return 8;
        },
      ),
    ).toEqual({ acquired: true, value: 8 });
    expect(commands[0].args.slice(2)).toEqual(['PX', '300', 'NX']);
    expect(String(commands[0].args[1])).toMatch(/^[a-f0-9-]{36}$/);
    expect(commands.at(-1)?.args[3]).toBe(commands[0].args[1]);
    expect(await lease.isOwned()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('繁忙不执行操作，等待期限过后不再额外发起一次获取', async () => {
    const { redis, commands } = fixture(() => null);
    const action = jest.fn();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300, waitMs: 120 },
      action,
    );
    await advance(120);
    expect(await operation).toEqual({ acquired: false });
    expect(action).not.toHaveBeenCalled();
    expect(commands).toHaveLength(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('长操作持续续期，完成后停止全部心跳', async () => {
    const { redis, commands } = fixture();
    const entered = deferred<RedisLockLease>();
    const finish = deferred<number>();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300 },
      async (lease) => {
        entered.resolve(lease);
        return finish.promise;
      },
    );
    const lease = await entered.promise;
    await advance(900);
    expect(
      commands.filter((command) => String(command.args[0]).includes('PEXPIRE'))
        .length,
    ).toBeGreaterThanOrEqual(8);
    expect(lease.signal.aborted).toBe(false);
    finish.resolve(9);
    expect(await operation).toEqual({ acquired: true, value: 9 });
    const count = commands.length;
    await advance(1000);
    expect(commands).toHaveLength(count);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('续期失去凭证时通知操作中止，不能返回业务成功', async () => {
    const { redis } = fixture((command) => {
      if (command.name === 'set') return 'OK';
      if (String(command.args[0]).includes('PEXPIRE')) return 0;
      return 1;
    });
    const entered = deferred<void>();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300 },
      async (lease) => {
        entered.resolve();
        return onAbort(lease);
      },
    ).catch((error: unknown) => error);
    await entered.promise;
    await advance(100);
    expect(await operation).toBeInstanceOf(RedisLockLostError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('释放前等待已发送的续期，避免清理结束后再续期', async () => {
    const { redis, commands } = fixture((command) => {
      if (command.name === 'set') return 'OK';
      if (String(command.args[0]).includes('PEXPIRE')) return pendingReply;
      return 1;
    });
    const entered = deferred<void>();
    const finish = deferred<void>();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300 },
      async () => {
        entered.resolve();
        return finish.promise;
      },
    );
    await entered.promise;
    await advance(100);
    const renewal = commands.find((command) =>
      String(command.args[0]).includes('PEXPIRE'),
    );
    expect(renewal).toBeDefined();
    finish.resolve();
    await Promise.resolve();
    expect(
      commands.some((command) => String(command.args[0]).includes('DEL')),
    ).toBe(false);
    renewal?.resolve(1);
    await operation;
    expect(String(commands.at(-1)?.args[0])).toContain('DEL');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('看门狗尚未调度时仍按单调时间拒绝已经过期的操作结果', async () => {
    const { redis } = fixture();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300 },
      async () => {
        entered.resolve();
        return finish.promise;
      },
    ).catch((error: unknown) => error);
    await entered.promise;
    jest.setSystemTime(350);
    finish.resolve();
    expect(await operation).toBeInstanceOf(RedisLockLostError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('调用方取消会中止操作并释放本次凭证', async () => {
    const { redis, commands } = fixture();
    const entered = deferred<void>();
    const caller = new AbortController();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300, signal: caller.signal },
      async (lease) => {
        entered.resolve();
        return onAbort(lease);
      },
    ).catch((error: unknown) => error);
    await entered.promise;
    caller.abort();
    expect(await operation).toBeInstanceOf(RedisLockLostError);
    expect(String(commands.at(-1)?.args[0])).toContain('DEL');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('获取命令超时后不启动业务，并尝试清理未确认的占位', async () => {
    const { redis, commands } = fixture((command) => {
      if (command.name === 'set') return pendingReply;
      return 0;
    });
    const action = jest.fn();
    const operation = withRedisLock(
      redis,
      'resource',
      { ttlMs: 300 },
      action,
    ).catch((error: unknown) => error);
    await advance(100);
    expect(await operation).toMatchObject({ message: 'Command timed out' });
    expect(action).not.toHaveBeenCalled();
    expect(String(commands.at(-1)?.args[0])).toContain('DEL');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('业务错误和释放错误同时发生时保留两个原因', async () => {
    const business = new Error('business failed');
    const cleanup = new Error('cleanup failed');
    const { redis } = fixture((command) => {
      if (command.name === 'set') return 'OK';
      return cleanup;
    });
    await expect(
      withRedisLock(redis, 'resource', {}, async () => {
        throw business;
      }),
    ).rejects.toMatchObject({ errors: [business, cleanup], cause: business });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('拒绝会离线重放锁命令的普通连接', async () => {
    const { redis, client, commands } = fixture();
    client.options.autoResendUnfulfilledCommands = true;
    await expect(
      withRedisLock(redis, 'resource', {}, jest.fn()),
    ).rejects.toThrow('未完成命令重发');
    expect(commands).toHaveLength(0);
  });
});
