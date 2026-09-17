import { automationDigest } from '@/common/automation/content-digest';
import { WORKFLOW_EXECUTION_KEY_PATTERN } from '../constants/execution';
import type {
  WorkflowActivityState,
  WorkflowNodeSnapshot,
} from '../contract/workflow-activity.types';
import {
  RUN_STATUS,
  RUN_STATUS_GROUP,
} from '@/common/automation/constants/run-status';

/**
 * 汇总同一标准节点时优先展示仍在执行的实例，全部结束后才展示最新轮次，数据库返回顺序不影响状态。
 * @param candidate - 本次遇到的活动状态。
 * @param current - 已选择的同节点状态，首次为空。
 * @returns 候选更能代表当前节点状态时返回真。
 */
export function preferWorkflowActivity(
  candidate: WorkflowActivityState,
  current?: WorkflowActivityState,
): boolean {
  if (!current) return true;
  const candidateActive = RUN_STATUS_GROUP.activityOpen.includes(
    candidate.status,
  );
  const currentActive = RUN_STATUS_GROUP.activityOpen.includes(current.status);
  if (candidateActive !== currentActive) return candidateActive;
  return candidate.visit > current.visit;
}

/**
 * 为新标准活动建立未派发状态，业务占用、脚本尝试与结果都从空边界开始。
 * @param visit - 当前标准元素的实例序号。
 * @returns 可直接持久化且尚未产生副作用的活动账本。
 */
export function createWorkflowActivityState(
  visit: number,
): WorkflowActivityState {
  return {
    status: RUN_STATUS.pending,
    visit,
    taskRunId: null,
    businessReceipt: null,
    preparedInput: null,
    scriptAttempts: null,
    outputValues: {},
    errorMessage: null,
    wakeAt: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * 在副作用已经核对或确定没有启动后统一结束活动，终态不再保留唤醒时间。
 * @param state - 工作流拥有的活动账本。
 * @param status - 已确认的成功、失败或取消状态。
 */
export function finishWorkflowActivity(
  state: WorkflowActivityState,
  status:
    | typeof RUN_STATUS.succeeded
    | typeof RUN_STATUS.failed
    | typeof RUN_STATUS.cancelled,
): void {
  state.status = status;
  state.finishedAt = new Date();
  state.wakeAt = null;
}

/**
 * 在读取边界补充节点展示身份，BPMN 持久账本只保存执行事实，不继续写入旧图端口及回环路径。
 * @param activity - 包含标准活动身份、循环索引和执行状态的记录。
 * @param activity.runId - 所属流程实例。
 * @param activity.elementId - 标准模型的节点标识。
 * @param activity.job - 标准引擎生成的本次活动信息。
 * @param activity.state - 工作流模块拥有的执行账本。
 * @returns 兼容运行详情接口的只读快照，不改变持久状态。
 */
export function workflowActivitySnapshot(activity: {
  runId: string;
  elementId: string;
  job: { index?: number };
  state: WorkflowActivityState;
}): WorkflowNodeSnapshot {
  return {
    ...activity.state,
    runId: activity.runId,
    nodeId: activity.elementId,
    loopIteration: activity.job.index ?? 0,
    loopPath: {},
    selectedPorts: [],
  };
}

/**
 * 重用已密封的业务回执，普通身份保持既有幂等键；过长或 Unicode 原生身份用摘要进入业务接口。
 * @param runId - 所属流程的持久身份。
 * @param executionId - 原生引擎生成的精确实例身份。
 * @param receipt - 已保存的业务执行键，恢复时不得重新计算。
 * @returns 满足业务执行键合同且不截断原生身份的稳定键。
 */
export function workflowActivityExecutionKey(
  runId: string,
  executionId: string,
  receipt: string | null,
): string {
  if (receipt) return receipt;
  const key = `workflow:${runId}:activity:${executionId}`;
  if (WORKFLOW_EXECUTION_KEY_PATTERN.test(key)) return key;
  return `workflow:${runId}:activity:${automationDigest(executionId)}`;
}
