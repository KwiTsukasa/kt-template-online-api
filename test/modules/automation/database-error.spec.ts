import { isAutomationUniqueConflict } from '@/common/automation/database-error';

describe('持久化错误分类', () => {
  it('连接故障和死锁不能当作唯一约束冲突', () => {
    for (const code of [
      'ECONNRESET',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
    ])
      expect(isAutomationUniqueConflict({ driverError: { code } })).toBe(false);
  });

  it('兼容 TypeORM 和驱动错误，只匹配确切索引名称', () => {
    const driverError = {
      code: 'ER_DUP_ENTRY',
      message:
        "Duplicate entry 'x' for key 'automation_workflow_run.uk_automation_workflow_active_subject'",
    };
    for (const error of [driverError, { driverError }]) {
      expect(isAutomationUniqueConflict(error)).toBe(true);
      expect(
        isAutomationUniqueConflict(
          error,
          'uk_automation_workflow_active_subject',
        ),
      ).toBe(true);
      expect(
        isAutomationUniqueConflict(
          error,
          'uk_automation_workflow_run_execution',
        ),
      ).toBe(false);
    }
  });
});
