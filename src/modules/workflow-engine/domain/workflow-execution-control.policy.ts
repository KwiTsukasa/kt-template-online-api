import { RUN_STATUS_GROUP } from '@/common/automation/constants/run-status';
import type { WorkflowRunStatus } from '../contract/workflow-run.types';

type WorkflowExecutionControl = {
  status: WorkflowRunStatus;
  cancelRequested: boolean;
  errorMessage: string | null;
  deadlineAt: Date | string | number;
};

/**
 * 根据父流程的最新状态决定能否派发新副作用，取消、失败、终态和超时都立即撤销准入。
 * @param run - 数据库刚读出的控制字段，记录缺失时拒绝派发。
 * @param now - 本轮准入检查的当前时间戳。
 * @returns 父流程仍然活动且没有停止条件时返回真。
 */
export function workflowAllowsDispatch(
  run: WorkflowExecutionControl | null,
  now = Date.now(),
): boolean {
  if (!run || run.cancelRequested || run.errorMessage) return false;
  if (!RUN_STATUS_GROUP.workflowOpen.includes(run.status)) return false;
  return now < new Date(run.deadlineAt).getTime();
}
