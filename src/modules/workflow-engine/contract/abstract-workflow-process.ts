import { requireRequest } from '@/common/automation/validation';
import { WORKFLOW_EXECUTION_KEY_PATTERN } from '../constants/execution';
import {
  RUN_STATUS,
  RUN_STATUS_GROUP,
} from '@/common/automation/constants/run-status';

import {
  validateDataValues,
  type DataSchema,
} from '@/common/automation/data-schema';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import { normalizeWorkflowPayload } from '../domain/workflow-script.policy';
import type {
  WorkflowLaunchContext,
  WorkflowCompletionContext,
  WorkflowPreparedBusiness,
  WorkflowProcess,
  WorkflowStepDefinition,
  WorkflowStepInvocation,
  WorkflowStepAcceptance,
  WorkflowStepStop,
} from './workflow-process.interface';

export abstract class AbstractWorkflowProcess implements WorkflowProcess {
  readonly concurrencyGroup?: string;
  abstract readonly key: string;
  abstract readonly version: number;
  abstract readonly name: string;
  abstract readonly inputSchema: DataSchema;
  abstract readonly outputSchema: DataSchema;
  abstract readonly steps: readonly WorkflowStepDefinition[];

  /**
   * 由业务读取权威对象并校验发起条件，不启动操作或猜测对象身份。
   * @param context - 业务入口确认的对象、修订、操作者与提交值。
   * @returns 业务确认后的身份与输入快照。
   */
  abstract prepare(
    context: WorkflowLaunchContext,
  ): Promise<WorkflowPreparedBusiness>;

  /**
   * 在脚本启动前验证单步输入，再准备参数；停止意图不能产生新的业务授权。
   * @param invocation - 工作流持久步骤身份、输入与停止意图。
   * @returns 可以密封到步骤记录的业务参数。
   * @throws 身份、输入或准备结果无效，以及步骤请求停止时拒绝准备。
   */
  async prepareStep(
    invocation: WorkflowStepInvocation,
  ): Promise<Record<string, unknown>> {
    const step = this.step(invocation);
    requireRequest(
      !invocation.stopRequested,
      '步骤已经请求停止，禁止准备新的执行',
    );
    invocation.signal.throwIfAborted();
    const input = validateDefinitionInput(() =>
      validateDataValues(step.inputSchema, invocation.input),
    );
    const prepared = await this.prepareStepInput({ ...invocation, input });
    return validateDefinitionInput(() => normalizeWorkflowPayload(prepared));
  }

  /**
   * 全部脚本有稳定成功回执后才提交业务验收，再验证业务输出结构。
   * @param acceptance - 固定步骤、密封参数与有序脚本结果。
   * @returns 验收通过的步骤输出。
   * @throws 缺少成功回执、业务验收失败或输出不符合契约时拒绝完成。
   */
  async acceptStep(
    acceptance: WorkflowStepAcceptance,
  ): Promise<Record<string, unknown>> {
    const step = this.step(acceptance.invocation);
    requireRequest(
      acceptance.results.length &&
        !acceptance.results.some(
          (result) =>
            result.status !== RUN_STATUS.succeeded ||
            !result.executionId ||
            result.exitCode !== 0,
        ),
      '业务验收必须使用全部脚本的真实成功回执',
    );
    const output = await this.verifyStep(acceptance);
    return validateDefinitionInput(() =>
      validateDataValues(step.outputSchema, output),
    );
  }

  /**
   * 拒绝在脚本仍运行或副作用未确认时释放业务占用，允许没有启动脚本的准备步骤安全收尾。
   * @param context - 工作流核对后的密封步骤与全部尝试状态。
   * @throws 任一尝试尚未确认终态时拒绝释放占用。
   */
  async stopStep(context: WorkflowStepStop): Promise<void> {
    this.step(context.invocation);
    requireRequest(
      !context.attempts.some((attempt) =>
        RUN_STATUS_GROUP.executingScript.includes(attempt.status),
      ),
      '脚本尚未确认停止，禁止释放业务占用',
    );
    await this.releaseStep(context);
  }

  /**
   * 由业务幂等结束当前步骤的占用和状态；无占用的业务可以保留默认实现。
   * @param context - 同一执行键的准备参数及已确认终态的尝试账本。
   */
  protected async releaseStep(context: WorkflowStepStop): Promise<void> {
    void context;
  }

  /**
   * 业务仅准备单步参数、事实或密封授权，脚本选择与执行顺序由工作流声明。
   * @param invocation - 已验证输入的步骤上下文。
   * @returns 同一执行键可重读的业务参数，不含执行函数。
   */
  protected abstract prepareStepInput(
    invocation: WorkflowStepInvocation,
  ): Promise<Record<string, unknown>>;

  /**
   * 核对脚本输出与对象身份并幂等提交领域结果，不启动脚本或后继操作。
   * @param acceptance - 工作流保存的准备参数及有序脚本结果。
   * @returns 该步骤的业务输出。
   */
  protected abstract verifyStep(
    acceptance: WorkflowStepAcceptance,
  ): Promise<Record<string, unknown>>;

  /**
   * 验证流程输出后核对业务最终事实，图执行结束本身不能代替业务完成。
   * @param context - 固定业务身份和流程输出。
   */
  async complete(context: WorkflowCompletionContext): Promise<void> {
    const output = validateDefinitionInput(() =>
      validateDataValues(this.outputSchema, context.output),
    );
    await this.verifyResult({ ...context, output });
  }

  /**
   * 读取最终完成证据并验证身份，不在验收中派发操作或补造结果。
   * @param context - 固定业务身份和已验证结构的输出。
   */
  protected abstract verifyResult(
    context: WorkflowCompletionContext,
  ): Promise<void>;

  /**
   * 核对业务对象和步骤声明，防止接收不属于此接口的调用。
   * @param invocation - 工作流准备调用的步骤上下文。
   * @returns 声明的固定步骤契约。
   * @throws 步骤、执行键或业务身份非法时拒绝调用。
   */
  private step(invocation: WorkflowStepInvocation): WorkflowStepDefinition {
    const step = this.steps.find(
      (candidate) => candidate.key === invocation.stepKey,
    );
    requireRequest(step, '业务未实现此工作流步骤');
    requireRequest(
      WORKFLOW_EXECUTION_KEY_PATTERN.test(invocation.executionKey),
      '工作流步骤执行键无效',
    );
    requireRequest(
      invocation.business.scopeId &&
        invocation.business.subjectId &&
        Number.isSafeInteger(invocation.business.revision) &&
        invocation.business.revision >= 1,
      '工作流业务身份或修订无效',
    );
    return step;
  }
}
