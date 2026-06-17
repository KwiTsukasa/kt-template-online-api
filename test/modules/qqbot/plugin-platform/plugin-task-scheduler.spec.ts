const createdQueues: any[] = [];
const createdWorkers: any[] = [];

jest.mock('bullmq', () => ({
  Queue: class MockQueue {
    readonly schedulers = new Map<string, unknown>();

    constructor(
      public name: string,
      public options: unknown,
    ) {
      createdQueues.push(this);
    }

    async add(name: string, data: unknown, opts?: unknown) {
      return { data, id: `${name}-job`, name, opts };
    }

    async close() {}

    async removeJobScheduler(id: string) {
      this.schedulers.delete(id);
      return 1;
    }

    async upsertJobScheduler(
      id: string,
      repeat: unknown,
      template: unknown,
    ) {
      this.schedulers.set(id, { repeat, template });
      return { id };
    }

    async waitUntilReady() {}
  },
  Worker: class MockWorker {
    constructor(
      public name: string,
      public processor: (job: unknown) => Promise<unknown> | unknown,
      public options: unknown,
    ) {
      createdWorkers.push(this);
    }

    on() {
      return this;
    }

    async close() {}

    async waitUntilReady() {}
  },
}));

import {
  QqbotPluginTaskSchedulerService,
  QqbotPluginTaskWorkerProcessor,
} from '../../../../src/modules/qqbot/plugin-platform/application/task';

describe('QQBot plugin task scheduler', () => {
  beforeEach(() => {
    createdQueues.length = 0;
    createdWorkers.length = 0;
  });

  it('registers cron through BullMQ Job Scheduler with a stable scheduler id', async () => {
    const taskRepository = createTaskRepository([
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-1',
        installationId: 'install-1',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
    ]);
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      taskRepository as any,
    );

    await scheduler.syncTaskScheduler({
      cronExpression: '0 */6 * * *',
      enabled: true,
      id: 'task-1',
      installationId: 'install-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
    } as any);

    expect(createdQueues[0].schedulers.get('plugin-task:task-1')).toMatchObject(
      {
        repeat: { pattern: '0 */6 * * *' },
        template: {
          data: { taskId: 'task-1', triggerType: 'schedule' },
          name: 'execute-plugin-task',
        },
      },
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      { id: 'task-1' },
      expect.objectContaining({
        nextRunAt: expect.any(Date),
        runtimeStatus: 'scheduled',
      }),
    );
    await scheduler.onModuleDestroy();
  });

  it('resyncs only enabled tasks whose plugin installation is enabled', async () => {
    const taskRepository = createTaskRepository([
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-enabled',
        installationId: 'install-enabled',
        installationStatus: 'enabled',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-disabled-installation',
        installationId: 'install-disabled',
        installationStatus: 'disabled',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
    ]);
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      taskRepository as any,
    );

    await scheduler.onModuleInit();

    expect(createdQueues[0].schedulers.has('plugin-task:task-enabled')).toBe(
      true,
    );
    expect(
      createdQueues[0].schedulers.has('plugin-task:task-disabled-installation'),
    ).toBe(false);
    await scheduler.onModuleDestroy();
  });

  it('removes stale schedulers for tasks whose installation is no longer enabled on startup', async () => {
    const taskRepository = createTaskRepository([
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-disabled-installation',
        installationId: 'install-disabled',
        installationStatus: 'disabled',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
    ]);
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      taskRepository as any,
    );
    createdQueues[0].schedulers.set(
      'plugin-task:task-disabled-installation',
      {},
    );

    await scheduler.onModuleInit();

    expect(
      createdQueues[0].schedulers.has('plugin-task:task-disabled-installation'),
    ).toBe(false);
    expect(taskRepository.update).toHaveBeenCalledWith(
      { id: 'task-disabled-installation' },
      { nextRunAt: null, runtimeStatus: 'disabled' },
    );
    await scheduler.onModuleDestroy();
  });

  it('does not upsert a scheduler when direct sync sees a disabled installation', async () => {
    const taskRepository = createTaskRepository([
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-disabled-installation',
        installationId: 'install-disabled',
        installationStatus: 'disabled',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
    ]);
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      taskRepository as any,
    );

    const state = await scheduler.syncTaskScheduler({
      cronExpression: '0 */6 * * *',
      enabled: true,
      id: 'task-disabled-installation',
      installationId: 'install-disabled',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
    } as any);

    expect(
      createdQueues[0].schedulers.has('plugin-task:task-disabled-installation'),
    ).toBe(false);
    expect(state).toEqual({ nextRunAt: null, runtimeStatus: 'disabled' });
    expect(taskRepository.update).toHaveBeenCalledWith(
      { id: 'task-disabled-installation' },
      { nextRunAt: null, runtimeStatus: 'disabled' },
    );
    await scheduler.onModuleDestroy();
  });

  it('marks installation tasks disabled after removing their schedulers', async () => {
    const taskRepository = createTaskRepository([
      {
        cronExpression: '0 */6 * * *',
        enabled: true,
        id: 'task-1',
        installationId: 'install-1',
        taskKey: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      },
    ]);
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      taskRepository as any,
    );
    createdQueues[0].schedulers.set('plugin-task:task-1', {});

    await scheduler.removeSchedulersForInstallation('install-1');

    expect(createdQueues[0].schedulers.has('plugin-task:task-1')).toBe(false);
    expect(taskRepository.update).toHaveBeenCalledWith(
      { installationId: 'install-1' },
      { nextRunAt: null, runtimeStatus: 'disabled' },
    );
    await scheduler.onModuleDestroy();
  });

  it('executes a task job through the platform worker and stores only safe output keys', async () => {
    const task = {
      cronExpression: '0 */6 * * *',
      enabled: true,
      handlerName: 'syncBestdoriMainData',
      id: 'task-1',
      installationId: 'install-1',
      pluginId: 'plugin-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
    };
    const taskRepository = createTaskRepository([task]);
    const runRepository = createRunRepository();
    const platformService = {
      executeTask: jest.fn(async () => ({
        replyText: 'secret text',
        syncedKeys: ['songs'],
      })),
    };
    const processor = new QqbotPluginTaskWorkerProcessor(
      createConfigService(),
      platformService as any,
      taskRepository as any,
      runRepository as any,
    );

    await processor.onModuleInit();
    const result = await createdWorkers[0].processor({
      data: {
        input: { force: true, payload: 'secret payload' },
        taskId: 'task-1',
        triggerType: 'manual',
      },
      id: 'job-1',
    });

    expect(platformService.executeTask).toHaveBeenCalledWith({
      input: { force: true, payload: 'secret payload' },
      installationId: 'install-1',
      pluginId: 'plugin-1',
      taskHandlerName: 'syncBestdoriMainData',
      taskId: 'task-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
      triggerType: 'manual',
    });
    expect(runRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        safeSummary: { outputKeys: ['replyText', 'syncedKeys'] },
        status: 'success',
      }),
    );
    expect(taskRepository.update).toHaveBeenLastCalledWith(
      { id: 'task-1' },
      expect.objectContaining({
        nextRunAt: expect.any(Date),
        runtimeStatus: 'scheduled',
      }),
    );
    expect(JSON.stringify(runRepository.save.mock.calls)).not.toContain(
      'secret text',
    );
    expect(result).toEqual({
      ok: true,
      runId: 'run-1',
      status: 'success',
    });
    await processor.onModuleDestroy();
  });

  it('skips a scheduled task when its installation is disabled even if a stale scheduler fires', async () => {
    const task = {
      cronExpression: '0 */6 * * *',
      enabled: true,
      handlerName: 'syncBestdoriMainData',
      id: 'task-1',
      installationId: 'install-1',
      installationStatus: 'disabled',
      pluginId: 'plugin-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
    };
    const taskRepository = createTaskRepository([task]);
    const runRepository = createRunRepository();
    const platformService = {
      executeTask: jest.fn(async () => ({ syncedKeys: ['songs'] })),
    };
    const processor = new QqbotPluginTaskWorkerProcessor(
      createConfigService(),
      platformService as any,
      taskRepository as any,
      runRepository as any,
    );

    await processor.onModuleInit();
    const result = await createdWorkers[0].processor({
      data: {
        taskId: 'task-1',
        triggerType: 'schedule',
      },
      id: 'stale-job-1',
    });

    expect(platformService.executeTask).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      reason: 'installation-disabled',
      runId: 'run-1',
      status: 'skipped',
    });
    expect(taskRepository.update).toHaveBeenLastCalledWith(
      { id: 'task-1' },
      expect.objectContaining({
        lastError: 'installation-disabled',
        runtimeStatus: 'scheduled',
      }),
    );
    await processor.onModuleDestroy();
  });
});

function createConfigService(): any {
  return {
    get: (key: string) =>
      ({
        QQBOT_PLUGIN_QUEUE_REDIS_HOST: 'redis.local',
        QQBOT_PLUGIN_TASK_QUEUE_REDIS_PREFIX: 'kt:qqbot:plugin-task',
      })[key],
  };
}

function createTaskRepository(tasks: any[]) {
  let idFilter: string | undefined;
  let queryMode: 'schedulable' | 'stale' = 'schedulable';
  const queryBuilder = {
    andWhere: jest.fn((_clause?: string, params?: any) => {
      if (params?.taskId) idFilter = params.taskId;
      if (
        typeof _clause === 'string' &&
        _clause.includes('installation.status <>')
      ) {
        queryMode = 'stale';
      }
      return queryBuilder;
    }),
    getCount: jest.fn(async () => queryBuilder.getMany().then((rows) => rows.length)),
    getMany: jest.fn(async () =>
      tasks.filter(
        (task) => {
          const matchesId = !idFilter || task.id === idFilter;
          const installationEnabled =
            !task.installationStatus || task.installationStatus === 'enabled';
          if (queryMode === 'stale') {
            return matchesId && task.enabled === true && !installationEnabled;
          }
          return matchesId && task.enabled === true && installationEnabled;
        },
      ),
    ),
    innerJoin: jest.fn(() => queryBuilder),
    where: jest.fn((_clause?: string, params?: any) => {
      idFilter = params?.taskId;
      queryMode =
        typeof _clause === 'string' && _clause.includes('installation.status <>')
          ? 'stale'
          : 'schedulable';
      return queryBuilder;
    }),
  };
  return {
    createQueryBuilder: jest.fn(() => queryBuilder),
    find: jest.fn(async () => tasks),
    findOne: jest.fn(async ({ where }: any) =>
      tasks.find((task) => task.id === where.id) || null,
    ),
    save: jest.fn(async (value) => value),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

function createRunRepository() {
  let runningRun: any;
  return {
    findOne: jest.fn(async ({ where }: any) =>
      where.status === 'running' ? runningRun || null : null,
    ),
    save: jest.fn(async (value: any) => {
      const next = { ...value, id: value.id || 'run-1' };
      if (next.status === 'running') {
        runningRun = next;
      } else {
        runningRun = undefined;
      }
      return next;
    }),
  };
}
