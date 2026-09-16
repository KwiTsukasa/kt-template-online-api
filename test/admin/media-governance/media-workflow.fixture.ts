import type { EntityManager } from 'typeorm';
import type { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import type { MediaGovernanceStateStore } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';

/**
 * 为纯媒体领域测试显式装配事务和入流回调替身，真实实例原子性另由 HTTP 与 MySQL 验证。
 * @param eventStream - 控制器测试注入的事件流，用于保留真实 SSE 行为。
 * @returns 不含独立执行器的媒体领域服务。
 */
export function createMediaWorkflowFixture(eventStream?: MediaGovernanceEventStreamService): MediaGovernanceService {
  const store = {
    isReady: () => true,
    loadTasks: async () => [],
    saveTask: async () => undefined,
    deleteTask: async (input) => {
      await input.beforeDelete?.({} as EntityManager);
      return { clearedWorkItemId: input.expectedWorkItemId };
    },
    createTask: async (_task, enroll) => enroll({} as EntityManager),
  } satisfies Pick<MediaGovernanceStateStore, 'isReady' | 'loadTasks' | 'saveTask' | 'createTask' | 'deleteTask'>;
  const service = new MediaGovernanceService(eventStream, undefined, store as MediaGovernanceStateStore);
  service.connectWorkflowCreation(async () => undefined, async () => undefined);
  return service;
}
