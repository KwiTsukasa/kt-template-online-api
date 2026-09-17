import type { DataSource, EntityManager } from 'typeorm';
import { withDatabaseLock } from '@/common/locks/database-lock';
import type { LockResult } from '@/common/locks/lock.types';

export type WorkflowRunLockMode = 'interactive' | 'background';
const LOCK_WAIT_SECONDS: Record<WorkflowRunLockMode, number> = {
  interactive: 3,
  background: 0,
};

/**
 * 让推进、消息和人工办理使用同一流程锁及独占连接，业务自行决定事务范围；所有退出路径都释放连接。
 * @param database - 提供独占查询连接的工作流数据库。
 * @param runId - 已由业务权限边界核验的流程实例身份。
 * @param mode - 交互操作短等竞争锁，后台推进立即跳过繁忙实例。
 * @param action - 获锁后使用同一连接管理器执行的业务操作。
 * @returns 是否获锁及业务结果，未获锁时不会调用业务操作。
 * @throws 获取或释放锁失败时丢弃不确定的物理会话并传播错误；业务异常完成解锁后继续传播。
 */
export async function withWorkflowRunLock<T>(
  database: DataSource,
  runId: string,
  mode: WorkflowRunLockMode,
  action: (manager: EntityManager) => Promise<T>,
): Promise<LockResult<T>> {
  return withDatabaseLock(
    database,
    `kt:workflow:${runId}`,
    LOCK_WAIT_SECONDS[mode],
    action,
  );
}
