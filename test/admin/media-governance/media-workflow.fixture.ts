import type { EntityManager } from 'typeorm';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import type { MediaGovernanceStateStore } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';

/**
 * 为纯媒体领域测试显式装配事务和入流回调替身，真实实例原子性另由 HTTP 与 MySQL 验证。
 * @returns 不含独立执行器的媒体领域服务。
 */
export function createMediaWorkflowFixture(): MediaGovernanceService {
  const store = {
    isReady: () => false,
    loadTasks: async () => [],
    saveTask: async () => undefined,
    deleteTask: async (input) => {
      await input.beforeDelete?.({} as EntityManager);
      return { clearedWorkItemId: input.expectedWorkItemId };
    },
    createTask: async (_task, enroll) => enroll({} as EntityManager),
  } satisfies Pick<MediaGovernanceStateStore, 'isReady' | 'loadTasks' | 'saveTask' | 'createTask' | 'deleteTask'>;
  const service = new MediaGovernanceService(undefined, undefined, store as MediaGovernanceStateStore);
  service.connectWorkflowCreation(async () => undefined, async () => undefined);
  return service;
}
