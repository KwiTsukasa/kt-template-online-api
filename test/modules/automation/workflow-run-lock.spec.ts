import type { DataSource, EntityManager } from 'typeorm';
import { withWorkflowRunLock } from '@/modules/workflow-engine/infrastructure/workflow-run-lock';

const fixture = (acquired: number | null = 1) => {
  const manager = {} as EntityManager;
  const session = { destroy: jest.fn() };
  const runner = {
    manager,
    connect: jest.fn(async () => session),
    release: jest.fn(async () => undefined),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('RELEASE_LOCK')) return [{ released: 1 }];
      return [{ acquired }];
    }),
  };
  const database = { createQueryRunner: () => runner } as unknown as DataSource;
  return { database, runner, manager, session };
};

describe('workflow run lock', () => {
  it.each([
    ['interactive', 3],
    ['background', 0],
  ] as const)(
    'shares the same lock key in %s mode and preserves false results',
    async (mode, wait) => {
      const { database, runner, manager } = fixture();
      const action = jest.fn(async (current) => {
        expect(current).toBe(manager);
        return false;
      });
      expect(
        await withWorkflowRunLock(database, 'run-1', mode, action),
      ).toEqual({ acquired: true, value: false });
      expect(runner.query).toHaveBeenNthCalledWith(
        1,
        'SELECT GET_LOCK(?, ?) AS acquired',
        ['kt:workflow:run-1', wait],
      );
      expect(runner.query).toHaveBeenNthCalledWith(
        2,
        'SELECT RELEASE_LOCK(?) AS released',
        ['kt:workflow:run-1'],
      );
      expect(runner.release).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0])('never enters or unlocks a busy lock (%s)', async (acquired) => {
    const { database, runner } = fixture(acquired);
    const action = jest.fn();
    expect(
      await withWorkflowRunLock(database, 'run-1', 'background', action),
    ).toEqual({ acquired: false });
    expect(action).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('releases its connection when connect fails without attempting unlock', async () => {
    const { database, runner } = fixture();
    const failure = new Error('connection failed');
    runner.connect.mockRejectedValueOnce(failure);
    await expect(
      withWorkflowRunLock(database, 'run-1', 'interactive', jest.fn()),
    ).rejects.toBe(failure);
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('unlocks and releases when the business transaction fails', async () => {
    const { database, runner } = fixture();
    const failure = new Error('business failed');
    await expect(
      withWorkflowRunLock(database, 'run-1', 'interactive', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(runner.query).toHaveBeenLastCalledWith(
      'SELECT RELEASE_LOCK(?) AS released',
      ['kt:workflow:run-1'],
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('discards a possibly locked physical session before release when unlock fails', async () => {
    const { database, runner, session } = fixture();
    const failure = new Error('unlock failed');
    runner.query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockRejectedValueOnce(failure);
    await expect(
      withWorkflowRunLock(
        database,
        'run-1',
        'background',
        async () => undefined,
      ),
    ).rejects.toBe(failure);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(session.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      runner.release.mock.invocationCallOrder[0],
    );
  });

  it('discards the physical session when acquisition outcome is unknown', async () => {
    const { database, runner, session } = fixture();
    runner.query.mockRejectedValueOnce(new Error('acquire response lost'));
    const action = jest.fn();
    await expect(
      withWorkflowRunLock(database, 'run-1', 'background', action),
    ).rejects.toThrow('acquire response lost');
    expect(action).not.toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('does not confuse an unknown database result with normal contention', async () => {
    const { database, runner, session } = fixture(null);
    const action = jest.fn();
    await expect(
      withWorkflowRunLock(database, 'run-1', 'background', action),
    ).rejects.toThrow('锁状态无法确认');
    expect(action).not.toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'ablation: database exclusion enabled=%s determines whether two callers overlap',
    async (enabled) => {
      let held = false;
      let active = 0;
      let maximum = 0;
      let releaseFirst: () => void = () => undefined;
      let enteredFirst: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enteredFirst = resolve;
      });
      const database = {
        createQueryRunner: () => ({
          manager: {},
          connect: async () => undefined,
          release: async () => undefined,
          query: async (sql: string) => {
            if (sql.includes('RELEASE_LOCK')) {
              held = false;
              return [{ released: 1 }];
            }
            if (enabled && held) return [{ acquired: 0 }];
            held = true;
            return [{ acquired: 1 }];
          },
        }),
      } as unknown as DataSource;
      const first = withWorkflowRunLock(
        database,
        'same-run',
        'background',
        async () => {
          active++;
          maximum = Math.max(maximum, active);
          enteredFirst();
          await hold;
          active--;
        },
      );
      try {
        await entered;
        const second = await withWorkflowRunLock(
          database,
          'same-run',
          'background',
          async () => {
            active++;
            maximum = Math.max(maximum, active);
            active--;
          },
        );
        expect(second.acquired).toBe(!enabled);
        if (enabled) expect(maximum).toBe(1);
        else expect(maximum).toBe(2);
      } finally {
        releaseFirst();
        await first;
      }
    },
  );
});
