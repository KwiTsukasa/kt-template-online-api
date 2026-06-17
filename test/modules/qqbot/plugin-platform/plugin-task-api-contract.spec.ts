import { QqbotPluginPlatformTaskController } from '../../../../src/modules/qqbot/plugin-platform/contract/plugin-platform-task.controller';
import { ToolsService } from '../../../../src/common';
import { QqbotPluginTaskService } from '../../../../src/modules/qqbot/plugin-platform/application/task';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

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
});
