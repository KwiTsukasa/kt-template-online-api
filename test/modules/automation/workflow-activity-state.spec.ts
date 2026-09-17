import {
  createWorkflowActivityState,
  preferWorkflowActivity,
  workflowActivityExecutionKey,
} from '@/modules/workflow-engine/domain/workflow-activity-state';
import { WORKFLOW_EXECUTION_KEY_PATTERN } from '@/modules/workflow-engine/constants/execution';

it('并发节点不会因较新实例先完成而被误标完成，查询顺序不影响摘要', () => {
  const waiting = {
    ...createWorkflowActivityState(1),
    status: 'waiting' as const,
  };
  const finished = {
    ...createWorkflowActivityState(2),
    status: 'succeeded' as const,
  };
  expect(preferWorkflowActivity(waiting, finished)).toBe(true);
  expect(preferWorkflowActivity(finished, waiting)).toBe(false);
  expect(
    preferWorkflowActivity(finished, { ...waiting, status: 'succeeded' }),
  ).toBe(true);
  expect(preferWorkflowActivity({ ...waiting, visit: 3 }, waiting)).toBe(true);
});

it('长身份和 Unicode 身份进入业务前转成稳定键，已保存回执与普通旧键保持不变', () => {
  expect(workflowActivityExecutionKey('123', 'step-1', null)).toBe(
    'workflow:123:activity:step-1',
  );
  for (const id of ['n'.repeat(239), '来源.检查']) {
    const key = workflowActivityExecutionKey('123', id, null);
    expect(WORKFLOW_EXECUTION_KEY_PATTERN.test(key)).toBe(true);
    expect(workflowActivityExecutionKey('123', id, null)).toBe(key);
    expect(workflowActivityExecutionKey('123', id, 'existing-receipt')).toBe(
      'existing-receipt',
    );
  }
});
