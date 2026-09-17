import { RUN_STATUS } from '@/common/automation/constants/run-status';
import type { DataSchema } from '@/common/automation/data-schema';
import type { EntityManager } from 'typeorm';
import type { PublishedReference } from '@/common/automation/definition.types';
import type {
  WorkflowScriptAttempt,
  WorkflowScriptResult,
} from './workflow-script.types';
import type { WorkflowRunView } from './workflow-run.types';
import type { WorkflowBusinessMessage } from './workflow-message.types';

export type WorkflowProcessReference = { key: string; version: number };
export type WorkflowBusinessIdentity = {
  scopeId: string;
  subjectId: string;
  revision: number;
};
export type WorkflowLaunchContext = WorkflowBusinessIdentity & {
  actorId: string;
  values: Record<string, unknown>;
  formValues?: Record<string, unknown>;
  bindingRevision?: number;
  transaction?: EntityManager;
};
export type WorkflowPreparedBusiness = {
  identity: WorkflowBusinessIdentity;
  input: Record<string, unknown>;
};
export type WorkflowBusinessContext = WorkflowBusinessIdentity & {
  processRef: WorkflowProcessReference;
  actorId: string;
  bindingRevision: number;
  requestHash: string;
};
export type WorkflowCompletionContext = {
  input?: Record<string, unknown>;
  business: WorkflowBusinessIdentity;
  output: Record<string, unknown>;
};
export type WorkflowBusinessBindingView = {
  workflowName?: string;
  processRef: WorkflowProcessReference;
  scopeId: string;
  workflowRef: PublishedReference;
  revision: number;
};
export const WORKFLOW_BUSINESSES = Symbol('WORKFLOW_BUSINESSES');
export interface WorkflowBusinessPort {
  receiveMessage: (
    processRef: WorkflowProcessReference,
    context: WorkflowLaunchContext,
    message: WorkflowBusinessMessage,
  ) => Promise<{ runId: string }>;
  assertIdle: (
    processRef: WorkflowProcessReference,
    scopeId: string,
    subjectId: string,
    manager: EntityManager,
  ) => Promise<void>;
  latest: (
    processRef: WorkflowProcessReference,
    scopeId: string,
    subjectId: string,
  ) => Promise<WorkflowRunView | null>;
  binding: (
    processRef: WorkflowProcessReference,
  ) => Promise<WorkflowBusinessBindingView | null>;
  launch: (
    processRef: WorkflowProcessReference,
    context: WorkflowLaunchContext,
    executionKey: string,
  ) => Promise<{ runId: string }>;
}
export type WorkflowStepDefinition = {
  key: string;
  name: string;
  description: string;
  inputSchema: DataSchema;
  outputSchema: DataSchema;
};
export type WorkflowHumanStepDefinition = {
  key: string;
  name: string;
  outputSchema: DataSchema;
};
export type WorkflowHumanStepAcceptance = {
  business: WorkflowBusinessIdentity;
  executionId: string;
  stepKey: string;
  actorId: string;
  values: Record<string, unknown>;
  transaction: EntityManager;
};
export type WorkflowStepInvocation = {
  business: WorkflowBusinessIdentity;
  actorId: string;
  stepKey: string;
  executionKey: string;
  input: Record<string, unknown>;
  receipt: string | null;
  stopRequested: boolean;
  signal: AbortSignal;
};
export type WorkflowStepAcceptance = {
  invocation: WorkflowStepInvocation;
  prepared: Record<string, unknown>;
  results: WorkflowScriptResult[];
};
export type WorkflowStepStop = {
  invocation: WorkflowStepInvocation;
  prepared: Record<string, unknown>;
  status: typeof RUN_STATUS.failed | typeof RUN_STATUS.cancelled;
  attempts: WorkflowScriptAttempt[];
};

/* 业务接入只实现业务事实与单步能力，执行顺序、等待和恢复由工作流运行时负责。 */
export interface WorkflowProcess extends WorkflowProcessReference {
  readonly concurrencyGroup?: string;
  readonly name: string;
  readonly launchSchema?: DataSchema;
  readonly inputSchema: DataSchema;
  readonly outputSchema: DataSchema;
  readonly steps: readonly WorkflowStepDefinition[];
  readonly humanSteps?: readonly WorkflowHumanStepDefinition[];

  /*
   * 在人工提交事务中核验领域事实并返回权威字段，不执行脚本或推进后继活动。
   * @param context - 已鉴权的待办身份、表单值和同一结果保存事务。
   * @returns 可映射到后继节点的业务事实，不能把页面提交的身份当作权威身份。
   */
  acceptHumanStep?(
    context: WorkflowHumanStepAcceptance,
  ): Promise<Record<string, unknown>>;

  /*
   * 核验业务对象、归属、修订和准入条件，产生可密封的输入，不启动任何业务操作。
   * @param context - 业务入口从权限边界传入的身份、操作者和表单值。
   * @returns 业务事实确认后的身份与输入快照。
   */
  prepare(context: WorkflowLaunchContext): Promise<WorkflowPreparedBusiness>;

  /*
   * 只准备单步业务参数或密封授权，禁止启动脚本、创建队列或自行推进后继步骤。
   * @param invocation - 工作流拥有的步骤身份、业务快照与输入。
   * @returns 可持久化的业务参数，同一执行键重复准备必须返回相同业务身份。
   */
  prepareStep(
    invocation: WorkflowStepInvocation,
  ): Promise<Record<string, unknown>>;

  /*
   * 在工作流确认全部脚本结束后验收真实结果并提交业务事实，不决定脚本选择、顺序或重试。
   * @param acceptance - 原业务参数及按声明顺序取得的脚本终态。
   * @returns 通过业务校验的步骤输出。
   */
  acceptStep(
    acceptance: WorkflowStepAcceptance,
  ): Promise<Record<string, unknown>>;

  /*
   * 在脚本全部确认退出后幂等释放单步业务占用；不得重试脚本或发起后继操作。
   * @param context - 当前步骤的密封参数、停止原因和全部脚本尝试回执。
   */
  stopStep(context: WorkflowStepStop): Promise<void>;

  /*
   * 在图到达结束节点时核对业务权威结果，不以节点执行完毕代替业务验收。
   * @param context - 固定业务身份和流程产生的输出。
   * @returns 业务完成条件通过后返回。
   */
  complete(context: WorkflowCompletionContext): Promise<void>;
}

export const WORKFLOW_PROCESSES = Symbol('WORKFLOW_PROCESSES');
export interface WorkflowProcessRegistryPort {
  register: (process: WorkflowProcess) => () => void;
}
