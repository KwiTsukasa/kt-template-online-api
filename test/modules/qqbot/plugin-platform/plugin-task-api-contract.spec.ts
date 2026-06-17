import { QqbotPluginPlatformTaskController } from '../../../../src/modules/qqbot/plugin-platform/contract/plugin-platform-task.controller';
import { ToolsService } from '../../../../src/common';
import { QqbotPluginTaskService } from '../../../../src/modules/qqbot/plugin-platform/application/task';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

/**
 * 创建 QQBot 插件平台对象或配置。
 */
const createRepositoryMock = () => ({
  findAndCount: jest.fn(async () => [[], 0]),
  findOne: jest.fn(async () => null),
  save: jest.fn(async (value) => value),
  update: jest.fn(async () => ({ affected: 1 })),
});

describe('QQBot plugin task API contract', () => {
  it('exposes task management routes under plugin-platform ownership', () => {
    expect(
      collectControllerRoutes([QqbotPluginPlatformTaskController]).map(
        routeKey,
      ),
    ).toEqual(
      expect.arrayContaining([
        'GET /qqbot/plugin-platform/tasks/page',
        'GET /qqbot/plugin-platform/tasks/:id',
        'POST /qqbot/plugin-platform/tasks/:id/enable',
        'POST /qqbot/plugin-platform/tasks/:id/disable',
        'POST /qqbot/plugin-platform/tasks/:id/cron',
        'POST /qqbot/plugin-platform/tasks/:id/run',
        'GET /qqbot/plugin-platform/tasks/:id/runs',
      ]),
    );
  });

  it('applies task page filters and safe pagination defaults', async () => {
    const taskRepository = createRepositoryMock();
    const runRepository = createRepositoryMock();
    const pluginRepository = createRepositoryMock();
    pluginRepository.findOne.mockResolvedValue({ id: 'plugin-1' });
    const service = new QqbotPluginTaskService(
      taskRepository as any,
      runRepository as any,
      pluginRepository as any,
      new ToolsService(),
    );

    const page = await service.pageTasks({
      enabled: 'true',
      pageNo: 'bad',
      pageSize: 'also-bad',
      pluginKey: 'bangdream',
      status: 'scheduled',
      taskKey: 'bangdream.bestdori.sync-main-data',
    });

    expect(pluginRepository.findOne).toHaveBeenCalledWith({
      where: { pluginKey: 'bangdream' },
    });
    expect(taskRepository.findAndCount).toHaveBeenCalledWith({
      order: { createTime: 'DESC' },
      skip: 0,
      take: 10,
      where: {
        enabled: true,
        pluginId: 'plugin-1',
        runtimeStatus: 'scheduled',
        taskKey: 'bangdream.bestdori.sync-main-data',
      },
    });
    expect(page).toMatchObject({ pageNo: 1, pageSize: 10, total: 0 });
  });

  it('applies task run status, trigger, and time-range filters', async () => {
    const taskRepository = createRepositoryMock();
    const runRepository = createRepositoryMock();
    const pluginRepository = createRepositoryMock();
    const service = new QqbotPluginTaskService(
      taskRepository as any,
      runRepository as any,
      pluginRepository as any,
      new ToolsService(),
    );

    await service.pageTaskRuns('task-1', {
      endTime: '2026-06-17 23:59:59',
      pageNo: 2,
      pageSize: 20,
      startTime: '2026-06-17 00:00:00',
      status: 'success',
      triggerType: 'schedule',
    });

    expect(runRepository.findAndCount).toHaveBeenCalledWith({
      order: { createTime: 'DESC' },
      skip: 20,
      take: 20,
      where: {
        createTime: expect.any(Object),
        status: 'success',
        taskId: 'task-1',
        triggerType: 'schedule',
      },
    });
  });

  it('clears stale next run time when disabling one task', async () => {
    const taskRepository = createRepositoryMock();
    const runRepository = createRepositoryMock();
    const pluginRepository = createRepositoryMock();
    const scheduler = {
      removeTaskScheduler: jest.fn(async () => undefined),
    };
    const nextRunAt = new Date('2026-06-17T06:00:00.000Z');
    taskRepository.findOne.mockResolvedValue({
      cronExpression: '0 */6 * * *',
      enabled: true,
      id: 'task-1',
      nextRunAt,
      runtimeStatus: 'scheduled',
    });
    const service = new QqbotPluginTaskService(
      taskRepository as any,
      runRepository as any,
      pluginRepository as any,
      new ToolsService(),
      scheduler as any,
    );

    const task = await service.disableTask('task-1');

    expect(taskRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        nextRunAt: null,
        runtimeStatus: 'disabled',
      }),
    );
    expect(scheduler.removeTaskScheduler).toHaveBeenCalledWith('task-1');
    expect(task).toMatchObject({
      enabled: false,
      nextRunAt: null,
      runtimeStatus: 'disabled',
    });
  });
});
