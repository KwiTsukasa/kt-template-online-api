import {
  AutomationValidationError,
  isAutomationRejection,
  requireExecutionState,
} from '@/common/automation/validation';
import {
  finishWorkflowActivity,
  workflowActivityExecutionKey,
} from '../domain/workflow-activity-state';
import {
  WORKFLOW_EXECUTION_TIMING,
  WORKFLOW_EXECUTION_ERROR,
} from '../constants/execution';
import {
  RUN_STATUS,
  RUN_STATUS_GROUP,
} from '@/common/automation/constants/run-status';
import type { WorkflowBpmnStep } from '../contract/workflow-bpmn.types';
import type {
  WorkflowProcess,
  WorkflowStepInvocation,
} from '../contract/workflow-process.interface';
import type {
  WorkflowActivityState,
  WorkflowActivityContext,
} from '../contract/workflow-activity.types';
import { bindWorkflowValues } from '../domain/workflow-value-binding.policy';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import { WorkflowScriptExecutionService } from './workflow-script-execution.service';

export class WorkflowBusinessStepService {
  constructor(
    private readonly processes: WorkflowProcessRegistry,
    private readonly scripts?: WorkflowScriptExecutionService,
  ) {}

  /**
   * 由业务准备参数后交工作流按序执行脚本，再调用业务验收；所有脚本控制与尝试均由工作流持久化。
   * @param node - 固定业务步骤及输入映射。
   * @param state - 工作流拥有的准备参数与脚本尝试账本。
   * @param context - 本次标准活动的输入快照、精确执行身份及统一控制端口。
   * @throws 运行意图或结果无法持久化时向恢复层传递异常；脚本与业务校验失败记录到节点状态。
   */
  async advance(
    node: Extract<WorkflowBpmnStep, { kind: 'business' | 'script' }>,
    state: WorkflowActivityState,
    context: WorkflowActivityContext,
  ): Promise<void> {
    let stopping = false;
    const refreshStop = async () => {
      if (!stopping) {
        stopping = await context.control.shouldStop();
      }
      return stopping;
    };
    await refreshStop();
    if (
      !stopping &&
      state.wakeAt &&
      new Date(state.wakeAt).getTime() > Date.now()
    )
      return;
    if (!state.startedAt) state.startedAt = new Date();
    state.status = RUN_STATUS.waiting;
    state.finishedAt = null;
    state.wakeAt = new Date(Date.now() + WORKFLOW_EXECUTION_TIMING.recoveryMs);
    await context.control.save();
    let process: WorkflowProcess | undefined;
    let invocation: WorkflowStepInvocation | undefined;
    let settlementPending = false;
    try {
      const business = context.business;
      requireExecutionState(
        business,
        WORKFLOW_EXECUTION_ERROR.businessUnavailable,
      );
      requireExecutionState(
        this.scripts,
        WORKFLOW_EXECUTION_ERROR.scriptsUnavailable,
      );
      process = this.processes.resolve(business.processRef);
      const executionKey = workflowActivityExecutionKey(
        context.runId,
        context.executionId,
        state.businessReceipt,
      );
      invocation = {
        business,
        actorId: business.actorId,
        stepKey: node.stepKey,
        executionKey,
        input: bindWorkflowValues(
          node.input,
          context.input,
          context.progress,
          context.iterationIndex,
        ),
        receipt: state.businessReceipt,
        stopRequested: stopping,
        signal: AbortSignal.timeout(
          WORKFLOW_EXECUTION_TIMING.businessDeadlineMs,
        ),
      };
      if (!state.preparedInput) {
        invocation.stopRequested = await refreshStop();
        if (stopping) {
          finishWorkflowActivity(state, RUN_STATUS.cancelled);
          return;
        }
        state.preparedInput = await process.prepareStep(invocation);
        state.businessReceipt = invocation.executionKey;
        await context.control.save();
      }
      const result = await this.scripts.advance(
        node.scripts,
        invocation,
        state,
        {
          processKey: business.processRef.key,
          params: node.scripts.map((script) =>
            bindWorkflowValues(
              script.params,
              context.input,
              context.progress,
              context.iterationIndex,
            ),
          ),
          control: { save: context.control.save, shouldStop: refreshStop },
        },
      );
      state.errorMessage = null;
      if (result.status === RUN_STATUS.waiting) {
        state.errorMessage = '等待工作流脚本回执';
        return;
      }
      if (result.status === RUN_STATUS.succeeded) {
        state.outputValues = await process.acceptStep({
          invocation,
          prepared: state.preparedInput,
          results: result.results,
        });
      } else {
        settlementPending = true;
        await process.stopStep({
          invocation,
          prepared: state.preparedInput,
          status: result.status,
          attempts: structuredClone(state.scriptAttempts ?? []),
        });
        settlementPending = false;
        state.errorMessage = '工作流脚本未全部成功';
      }
      state.wakeAt = null;
      state.finishedAt = new Date();
      state.status = result.status;
      if (result.status !== RUN_STATUS.succeeded && !stopping)
        state.status = RUN_STATUS.failed;
    } catch (error) {
      if (!isAutomationRejection(error)) throw error;
      const unresolved = state.scriptAttempts?.some((attempt) =>
        RUN_STATUS_GROUP.executingScript.includes(attempt.status),
      );
      if (!unresolved && !settlementPending && state.preparedInput) {
        try {
          requireExecutionState(process && invocation, '业务停止接口不可用');
          let status: typeof RUN_STATUS.cancelled | typeof RUN_STATUS.failed =
            RUN_STATUS.failed;
          if (stopping) status = RUN_STATUS.cancelled;
          await process.stopStep({
            invocation,
            prepared: state.preparedInput,
            status,
            attempts: structuredClone(state.scriptAttempts ?? []),
          });
        } catch {
          settlementPending = true;
        }
      }
      if (!unresolved && !settlementPending) {
        state.status = RUN_STATUS.failed;
        if (stopping) state.status = RUN_STATUS.cancelled;
        state.finishedAt = new Date();
        state.wakeAt = null;
        state.errorMessage = WORKFLOW_EXECUTION_ERROR.businessRejected;
        if (error instanceof AutomationValidationError)
          state.errorMessage = error.message;
        return;
      }
      state.status = RUN_STATUS.waiting;
      state.finishedAt = null;
      state.wakeAt = new Date(
        Date.now() + WORKFLOW_EXECUTION_TIMING.recoveryMs,
      );
      state.errorMessage =
        '步骤参数或脚本结果尚未通过校验，工作流保留原尝试等待核对';
      if (settlementPending)
        state.errorMessage = '脚本已退出，等待业务确认释放步骤占用';
    }
  }
}
