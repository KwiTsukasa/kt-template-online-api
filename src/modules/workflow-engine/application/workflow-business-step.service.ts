import type { WorkflowNode } from '../contract/workflow.types';
import type { WorkflowProcess, WorkflowStepInvocation } from '../contract/workflow-process.interface';
import type { WorkflowNodeRun, WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { bindWorkflowValues, type NodeProgress } from '../domain/workflow-execution.policy';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import { WorkflowScriptExecutionService } from './workflow-script-execution.service';

export class WorkflowBusinessStepService {
  constructor(private readonly processes: WorkflowProcessRegistry, private readonly scripts?: WorkflowScriptExecutionService) {}

  /**
   * 由业务准备参数后交工作流按序执行脚本，再调用业务验收；所有脚本控制与尝试均由工作流持久化。
   * @param node - 固定业务步骤及输入映射。
   * @param state - 工作流拥有的准备参数与脚本尝试账本。
   * @param run - 固定业务身份和运行期限。
   * @param progress - 上游已完成结果。
   * @param persist - 在派发前保存当前活动实例账本。
   * @param stopRequested - 只核对或停止既有操作，不允许开始新操作。
   * @param activityExecutionId - 标准 BPMN 活动实例身份，避免多实例和回环复用副作用键。
   * @param iterationIndex - 当前标准活动的循环索引，供步骤和脚本映射读取同一序号。
   * @throws 运行意图或结果无法持久化时向恢复层传递异常；脚本与业务校验失败记录到节点状态。
   */
  async advance(
    node: Extract<WorkflowNode, { type: 'business' }>,
    state: WorkflowNodeRun,
    run: WorkflowRun,
    progress: Map<string, NodeProgress>,
    persist: () => Promise<void>,
    stopRequested: boolean,
    activityExecutionId?: string,
    iterationIndex?: number,
  ): Promise<void> {
    if (
      !stopRequested &&
      state.wakeAt &&
      new Date(state.wakeAt).getTime() > Date.now()
    )
      return;
    if (!state.startedAt) state.startedAt = new Date();
    state.status = 'waiting';
    state.wakeAt = new Date(Date.now() + 30_000);
    await persist();
    let process: WorkflowProcess | undefined;
    let invocation: WorkflowStepInvocation | undefined;
    let settlementPending = false;
    try {
      const business = run.businessContext;
      if (!business) throw new Error('业务上下文缺失');
      if (!this.scripts) throw new Error('工作流脚本运行时尚未装配');
      process = this.processes.resolve(business.processRef);
      let executionKey = `workflow:${run.id}:${node.id}`;
      if (state.visit > 1) executionKey += `:visit:${state.visit}`;
      if (activityExecutionId) executionKey = `workflow:${run.id}:activity:${activityExecutionId}`;
      invocation = {
        business,
        actorId: business.actorId,
        stepKey: node.stepKey,
        executionKey,
        input: bindWorkflowValues(node.input, run.inputValues, progress, iterationIndex),
        receipt: state.businessReceipt,
        stopRequested,
        signal: AbortSignal.timeout(15_000),
      };
      if (!state.preparedInput) {
        if (stopRequested) {
          state.status = 'cancelled';
          state.finishedAt = new Date();
          state.wakeAt = null;
          return;
        }
        state.preparedInput = await process.prepareStep(invocation);
        state.businessReceipt = invocation.executionKey;
        await persist();
      }
      const result = await this.scripts.advance(
        node.scripts,
        invocation,
        business.processRef.key,
        state,
        node.scripts.map((script) =>
          bindWorkflowValues(script.params, run.inputValues, progress, iterationIndex),
        ),
        async () => {
          await persist();
        },
      );
      state.errorMessage = null;
      if (result.status === 'waiting') {
        state.errorMessage = '等待工作流脚本回执';
        return;
      }
      state.wakeAt = null;
      state.finishedAt = new Date();
      state.status = result.status;
      if (result.status === 'succeeded') {
        state.outputValues = await process.acceptStep({
          invocation,
          prepared: state.preparedInput,
          results: result.results,
        });
        state.selectedPorts = ['out'];
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
        if (!stopRequested) state.status = 'failed';
      }
    } catch {
      const unresolved = state.scriptAttempts?.some((attempt) =>
        ['running', 'unconfirmed'].includes(attempt.status),
      );
      if (!unresolved && !settlementPending && state.preparedInput) {
        try {
          if (!process || !invocation) throw new Error('业务停止接口不可用');
          let status: 'cancelled' | 'failed' = 'failed';
          if (stopRequested) status = 'cancelled';
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
        state.status = 'failed';
        if (stopRequested) state.status = 'cancelled';
        state.finishedAt = new Date();
        state.wakeAt = null;
        state.errorMessage = '业务步骤参数或结果未通过校验';
        return;
      }
      state.status = 'waiting';
      state.finishedAt = null;
      state.wakeAt = new Date(Date.now() + 30_000);
      state.errorMessage =
        '步骤参数或脚本结果尚未通过校验，工作流保留原尝试等待核对';
      if (settlementPending)
        state.errorMessage = '脚本已退出，等待业务确认释放步骤占用';
    }
  }

}
