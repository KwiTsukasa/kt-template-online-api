import type { DataSource } from 'typeorm';
import type { Connection } from 'mysql2/promise';
import {
  closeMysqlLockConnection,
  withDatabaseLock,
  withMysqlConnectionLock,
} from '@/common/locks/database-lock';
import type { LockLease } from '@/common/locks/lock.types';

const fixture = () => {
  const session = { destroy: jest.fn() };
  const manager = {};
  const query = jest.fn(
    async (sql: string): Promise<Array<Record<string, unknown>>> => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
      if (sql.includes('IS_USED_LOCK')) return [{ owned: 1 }];
      return [{ released: 1 }];
    },
  );
  const runner = {
    manager,
    query,
    connect: jest.fn(async () => session),
    release: jest.fn(async () => undefined),
  };
  const database = {
    createQueryRunner: jest.fn(() => runner),
  } as unknown as DataSource;
  return { database, runner, session, manager, query };
};

describe('API全局数据库锁', () => {
  it('把同一连接和所有权探针交给操作，结束后的租约不会再查询已经归还的连接', async () => {
    const { database, query, manager } = fixture();
    let lease: LockLease;
    const result = await withDatabaseLock(
      database,
      'resource',
      5,
      async (current, currentLease) => {
        expect(current).toBe(manager);
        lease = currentLease;
        expect(await lease.isOwned()).toBe(true);
        return 7;
      },
    );
    expect(result).toEqual({ acquired: true, value: 7 });
    expect(await lease.isOwned()).toBe(false);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('所有权查询状态未知时丢弃物理会话，不把错误当作正常未持有', async () => {
    const { database, query, session, runner } = fixture();
    query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ owned: null }]);
    await expect(
      withDatabaseLock(database, 'resource', 0, async (_manager, lease) =>
        lease.isOwned(),
      ),
    ).rejects.toThrow('锁状态无法确认');
    expect(query).toHaveBeenCalledTimes(2);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('释放回执表明已失锁时不能把业务返回值当作成功', async () => {
    const { database, query, session } = fixture();
    query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ released: 0 }]);
    await expect(
      withDatabaseLock(database, 'resource', 0, async () => 'result'),
    ).rejects.toThrow('操作完成前已丢失');
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('回调忽略失锁结果时仍不能返回成功', async () => {
    const { database, query, session } = fixture();
    query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ owned: 0 }]);
    await expect(
      withDatabaseLock(database, 'resource', 0, async (_manager, lease) => {
        expect(await lease.isOwned()).toBe(false);
        return 'ignored';
      }),
    ).rejects.toThrow('所有权已丢失');
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('获取响应悬挂时到期丢弃连接且不执行操作', async () => {
    jest.useFakeTimers();
    try {
      const { database, query, session, runner } = fixture();
      query.mockImplementationOnce(() => new Promise(() => undefined));
      const action = jest.fn();
      const operation = withDatabaseLock(database, 'resource', 0, action).catch(
        (error: unknown) => error,
      );
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      expect(await operation).toMatchObject({ message: '数据库锁查询超时' });
      expect(action).not.toHaveBeenCalled();
      expect(session.destroy).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('业务和释放同时失败时保留两个原因', async () => {
    const { database, query } = fixture();
    const business = new Error('business failure');
    const release = new Error('release failure');
    query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockRejectedValueOnce(release);
    await expect(
      withDatabaseLock(database, 'resource', 0, async () => {
        throw business;
      }),
    ).rejects.toMatchObject({ errors: [business, release], cause: business });
  });

  it.each([
    ['', 0],
    ['x'.repeat(65), 0],
    ['resource', -1],
    ['resource', Infinity],
  ] as const)('无效声明不会借用连接：%s/%s', async (name, wait) => {
    const { database } = fixture();
    await expect(
      withDatabaseLock(database, name, wait, jest.fn()),
    ).rejects.toThrow();
    expect(database.createQueryRunner).not.toHaveBeenCalled();
  });

  it('mysql2迁移连接的正常使用不提前关闭，持有者显式关闭后才结束会话', async () => {
    const connection = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
        if (sql.includes('IS_USED_LOCK')) return [[{ owned: 1 }], []];
        return [[{ released: 1 }], []];
      }),
      destroy: jest.fn(),
      end: jest.fn(async () => undefined),
    };
    const result = await withMysqlConnectionLock(
      connection as unknown as Connection,
      'migration',
      60,
      async (lease) => {
        expect(await lease.isOwned()).toBe(true);
        return 'done';
      },
    );
    expect(result).toEqual({ acquired: true, value: 'done' });
    expect(connection.end).not.toHaveBeenCalled();
    await closeMysqlLockConnection(connection as unknown as Connection);
    expect(connection.end).toHaveBeenCalledTimes(1);
  });

  it('异常迁移连接被丢弃后不再重复结束而覆盖原始错误', async () => {
    const connection = {
      query: jest.fn(async () => {
        throw new Error('unknown acquisition');
      }),
      destroy: jest.fn(),
      end: jest.fn(),
    };
    await expect(
      withMysqlConnectionLock(
        connection as unknown as Connection,
        'migration',
        10,
        jest.fn(),
      ),
    ).rejects.toThrow('unknown acquisition');
    await closeMysqlLockConnection(connection as unknown as Connection);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.end).not.toHaveBeenCalled();
  });
});
