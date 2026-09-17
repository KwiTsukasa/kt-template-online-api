import { requireExecutionState } from '@/common/automation/validation';
import {
  createWorkflowActivityState,
  finishWorkflowActivity,
} from '../domain/workflow-activity-state';
import {
  WORKFLOW_EXECUTION_TIMING,
  WORKFLOW_EXECUTION_ERROR,
} from '../constants/execution';
import type {
  WorkflowActivityContext,
  WorkflowNodeProgress,
} from '../contract/workflow-activity.types';
import { automationDigest } from '@/common/automation/content-digest';
import {
  RUN_STATUS,
  RUN_STATUS_GROUP,
} from '@/common/automation/constants/run-status';
import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validateDataValues } from '@/common/automation/data-schema';
import {
  RULE_ENGINE,
  type RuleEnginePort,
} from '@/modules/rule-engine/contract/rule.types';
import type {
  WorkflowBpmnDefinition,
  WorkflowBpmnStep,
} from '../contract/workflow-bpmn.types';
import { bindWorkflowValues } from '../domain/workflow-value-binding.policy';
import { parseWorkflowBpmn } from '../domain/workflow-bpmn.policy';
import { readBpmnContract } from '../domain/workflow-document.policy';
import { workflowAllowsDispatch } from '../domain/workflow-execution-control.policy';
import {
  advanceWorkflowBpmn,
  type WorkflowBpmnCompletion,
} from '../infrastructure/workflow-bpmn.runtime';
import { WorkflowBpmnActivity } from '../infrastructure/persistence/workflow-bpmn.entity';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowBusinessStepService } from './workflow-business-step.service';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import { WorkflowScriptExecutionService } from './workflow-script-execution.service';
import { isAutomationRejection } from '@/common/automation/validation';

@Injectable()
export class WorkflowBpmnExecutionService {
  private readonly businessSteps: WorkflowBusinessStepService;
  constructor(
    private readonly processes: WorkflowProcessRegistry,
    @Inject(RULE_ENGINE) private readonly rules: RuleEnginePort,
    @Optional() scripts?: WorkflowScriptExecutionService,
    @Optional()
    @Inject(TASK_EXECUTION)
    private readonly tasks?: TaskExecutionPort,
  ) {
    this.businessSteps = new WorkflowBusinessStepService(processes, scripts);
  }

  /**
   * 在现有流程锁内恢复标准令牌，把引擎快照和新活动意图原子落盘后才派发脚本。
   * @param run - 当前已锁定的工作流实例。
   * @param definition - 实例固定版本的结构化 BPMN 模型。
   * @param manager - 持有同一流程独占连接的数据库管理器。
   * @throws 数据库或标准模型恢复失败时保留原持久边界，交由既有工作流队列恢复。
   */
  async process(
    run: WorkflowRun,
    definition: WorkflowBpmnDefinition,
    manager: EntityManager,
  ): Promise<void> {
    const model = await parseWorkflowBpmn(definition);
    const contract = readBpmnContract(model);
    const activities = await manager.findBy(WorkflowBpmnActivity, {
      runId: run.id,
    });
    const expired = Date.now() >= new Date(run.deadlineAt).getTime();
    if (expired && !run.errorMessage) run.errorMessage = '流程总期限已结束';
    if (run.cancelRequested || run.errorMessage) {
      await this.stopRun(run, activities, manager);
      return;
    }
    if (!run.bpmnState || run.bpmnState.status === RUN_STATUS.waiting) {
      await this.advanceTokens(run, activities, model, manager);
    }
    // 标准事件已撤销令牌，但外部脚本退出必须另行确认，确认前不派发下游副作用。
    await this.stopActivities(run, activities, manager);
    if (
      activities.some(
        (activity) =>
          activity.cancelRequested &&
          activity.state.status === RUN_STATUS.waiting,
      )
    ) {
      await manager.update(
        WorkflowRun,
        { id: run.id },
        {
          status: RUN_STATUS.waiting,
          nextWakeAt: new Date(
            Date.now() + WORKFLOW_EXECUTION_TIMING.cancellationPollMs,
          ),
        },
      );
      return;
    }
    if (run.bpmnState.status !== RUN_STATUS.waiting) {
      await this.complete(run, contract);
      run.finishedAt = new Date();
      await manager.update(
        WorkflowRun,
        { id: run.id, cancelRequested: false },
        {
          status: run.status,
          outputValues: run.outputValues,
          errorMessage: run.errorMessage,
          finishedAt: run.finishedAt,
        },
      );
      return;
    }
    for (const activity of activities) {
      if (
        activity.delivered ||
        activity.cancelRequested ||
        !RUN_STATUS_GROUP.activityOpen.includes(activity.state.status)
      )
        continue;
      const current = await manager.findOneByOrFail(WorkflowRun, {
        id: run.id,
      });
      if (current.cancelRequested) break;
      await this.advanceActivity(run, activity, manager, false);
    }
    let wakeAt = Math.min(
      new Date(run.deadlineAt).getTime(),
      Date.now() + WORKFLOW_EXECUTION_TIMING.recoveryMs,
    );
    if (run.bpmnState.nextWakeAt !== null)
      wakeAt = Math.min(wakeAt, run.bpmnState.nextWakeAt);
    for (const activity of activities) {
      if (activity.delivered || activity.cancelRequested) continue;
      if (RUN_STATUS_GROUP.settled.includes(activity.state.status))
        wakeAt = Date.now();
      else if (activity.state.wakeAt)
        wakeAt = Math.min(wakeAt, new Date(activity.state.wakeAt).getTime());
    }
    await manager.update(
      WorkflowRun,
      { id: run.id, cancelRequested: false },
      { status: RUN_STATUS.waiting, nextWakeAt: new Date(wakeAt) },
    );
  }

  /**
   * 撤销未消费消息并确认活动退出，尚有外部步骤等待时保留运行，全部退出后记录取消或失败。
   * @param run - 已持有运行锁的流程实例。
   * @param activities - 当前流程的活动账本。
   * @param manager - 保存终态和下一次核对时间的连接。
   */
  private async stopRun(
    run: WorkflowRun,
    activities: WorkflowBpmnActivity[],
    manager: EntityManager,
  ): Promise<void> {
    for (const message of run.bpmnState?.messages ?? []) {
      if (message.status !== RUN_STATUS.pending) continue;
      message.status = 'discarded';
      message.deliveredAt = new Date().toISOString();
      delete message.values;
      delete message.correlation;
    }
    for (const activity of activities) activity.cancelRequested = true;
    await this.stopActivities(run, activities, manager);
    const active = activities.some(
      (activity) => activity.state.status === RUN_STATUS.waiting,
    );
    if (!active) {
      run.status = RUN_STATUS.failed;
      if (run.cancelRequested && !run.errorMessage)
        run.status = RUN_STATUS.cancelled;
      run.finishedAt = new Date();
    } else run.status = RUN_STATUS.waiting;
    run.nextWakeAt = new Date(
      Date.now() + WORKFLOW_EXECUTION_TIMING.cancellationPollMs,
    );
    await manager.update(
      WorkflowRun,
      { id: run.id },
      {
        bpmnState: run.bpmnState,
        status: run.status,
        errorMessage: run.errorMessage,
        finishedAt: run.finishedAt,
        nextWakeAt: run.nextWakeAt,
      },
    );
  }

  /**
   * 消费已保存结果并推进原生令牌，将新检查点和活动意图在派发副作用之前原子保存。
   * @param run - 当前固定版本的流程实例。
   * @param activities - 本轮恢复和新增的活动账本。
   * @param model - 已恢复引用的标准模型。
   * @param manager - 持有流程锁的数据库连接。
   * @throws 原生快照不能消费已保存结果或持久化失败时停止派发。
   */
  private async advanceTokens(
    run: WorkflowRun,
    activities: WorkflowBpmnActivity[],
    model: Awaited<ReturnType<typeof parseWorkflowBpmn>>,
    manager: EntityManager,
  ): Promise<void> {
    const completions: WorkflowBpmnCompletion[] = activities
      .filter(
        (activity) =>
          !activity.delivered &&
          !activity.cancelRequested &&
          RUN_STATUS_GROUP.settled.includes(activity.state.status),
      )
      .map((activity) => {
        if (activity.state.status === RUN_STATUS.failed)
          return {
            executionId: activity.executionId,
            error: {
              code: 'WORKFLOW_STEP_FAILED',
              message: activity.state.errorMessage ?? '工作流步骤失败',
            },
          };
        return {
          executionId: activity.executionId,
          output: activity.state.outputValues,
        };
      });
    const messages = structuredClone(run.bpmnState?.messages ?? []);
    const correlations = structuredClone(run.bpmnState?.correlations ?? {});
    const pendingMessages = messages.filter(
      (message) => message.status === RUN_STATUS.pending,
    );
    const advanced = await advanceWorkflowBpmn(
      model,
      run.bpmnState?.checkpoint ?? null,
      { input: run.inputValues },
      completions,
      pendingMessages.map((message) => ({
        id: message.nodeId,
        executionId: message.executionId,
        workflowMessage: true,
        values: message.values ?? {},
      })),
    );
    requireExecutionState(
      !advanced.unconsumedCompletionIds.length,
      'BPMN 快照无法消费已保存的活动结果',
    );
    const unconsumedSignals = new Set(advanced.unconsumedSignalIds);
    for (const message of pendingMessages) {
      message.status = 'delivered';
      if (unconsumedSignals.has(message.executionId))
        message.status = 'discarded';
      if (message.status === 'delivered' && message.correlation)
        correlations[message.correlation.processExecutionId] =
          message.correlation.keys;
      message.deliveredAt = new Date().toISOString();
      delete message.values;
      delete message.correlation;
    }
    run.bpmnState = {
      messages,
      correlations,
      checkpoint: advanced.checkpoint,
      status: advanced.status,
      error: advanced.error,
      nextWakeAt: advanced.nextWakeAt,
      outputs: advanced.checkpoint.outputs,
      activeActivities: advanced.activeActivities,
      transitions: [
        ...(run.bpmnState?.transitions ?? []),
        ...advanced.transitions,
      ].slice(-WORKFLOW_EXECUTION_TIMING.retainedTransitions),
    };
    const byExecution = new Map(
      activities.map((activity) => [activity.executionId, activity]),
    );
    const visitsByElement = new Map<string, number>();
    for (const activity of activities)
      visitsByElement.set(
        activity.elementId,
        (visitsByElement.get(activity.elementId) ?? 0) + 1,
      );
    for (const job of advanced.jobs) {
      if (byExecution.has(job.executionId)) continue;
      const visit = (visitsByElement.get(job.elementId) ?? 0) + 1;
      visitsByElement.set(job.elementId, visit);
      const activity = manager.create(WorkflowBpmnActivity, {
        runId: run.id,
        executionId: job.executionId,
        elementId: job.elementId,
        job,
        delivered: false,
        cancelRequested: false,
        state: createWorkflowActivityState(visit),
      });
      activities.push(activity);
      byExecution.set(activity.executionId, activity);
    }
    for (const completion of completions)
      byExecution.get(completion.executionId).delivered = true;
    for (const id of advanced.cancelledExecutionIds) {
      const activity = byExecution.get(id);
      if (activity) activity.cancelRequested = true;
    }
    if (advanced.status === RUN_STATUS.failed) {
      for (const activity of activities)
        if (!activity.delivered) activity.cancelRequested = true;
    }
    await manager.transaction(async (transaction) => {
      if (activities.length)
        await transaction.save(WorkflowBpmnActivity, activities);
      await transaction.update(
        WorkflowRun,
        { id: run.id },
        { bpmnState: run.bpmnState, status: RUN_STATUS.waiting },
      );
    });
  }

  /**
   * 核对标准引擎终态与流程输出，业务完成验收成功后才标记成功，技术故障保留恢复机会。
   * @param run - 已完成令牌推进的运行实例。
   * @param contract - 当前发布版本的流程输出契约。
   * @throws 数据库、网络和未分类异常继续交给恢复层。
   */
  private async complete(
    run: WorkflowRun,
    contract: ReturnType<typeof readBpmnContract>,
  ): Promise<void> {
    if (run.bpmnState.status === RUN_STATUS.failed) {
      run.status = RUN_STATUS.failed;
      run.errorMessage = run.bpmnState.error ?? 'BPMN 流程执行失败';
      return;
    }
    try {
      const output = validateDataValues(
        contract.outputSchema,
        bindWorkflowValues(
          contract.output,
          run.inputValues,
          this.progress(run.bpmnState.outputs),
        ),
      );
      if (run.businessContext)
        await this.processes.resolve(run.businessContext.processRef).complete({
          business: run.businessContext,
          input: run.inputValues,
          output,
        });
      run.status = RUN_STATUS.succeeded;
      run.outputValues = output;
    } catch (error) {
      if (!isAutomationRejection(error)) throw error;
      run.status = RUN_STATUS.failed;
      run.errorMessage = '流程输出或业务完成验收失败';
    }
  }

  /**
   * 调用统一业务步骤执行层或已发布规则，活动结果只属于当前标准实例身份。
   * @param run - 固定业务身份的流程实例。
   * @param activity - 标准引擎生成的活动实例及持久账本。
   * @param manager - 保存执行意图的数据库连接。
   * @param stop - 是否只能停止或核对已经启动的副作用。
   * @throws 内置动作能力未装配时拒绝派发或伪造取消成功。
   */
  private async advanceActivity(
    run: WorkflowRun,
    activity: WorkflowBpmnActivity,
    manager: EntityManager,
    stop: boolean,
  ): Promise<void> {
    const step = activity.job.step;
    const state = activity.state;
    const context: WorkflowActivityContext = {
      runId: run.id,
      executionId: activity.executionId,
      deadlineAt: new Date(run.deadlineAt).getTime(),
      business: run.businessContext,
      input:
        (activity.job.variables.input as Record<string, unknown>) ??
        run.inputValues,
      progress: this.progress(
        (activity.job.variables.outputs as Record<
          string,
          Record<string, unknown>
        >) ?? {},
      ),
      iterationIndex: activity.job.index,
      control: {
        save: async () => {
          await manager.save(WorkflowBpmnActivity, activity);
        },
        shouldStop: async () =>
          stop ||
          !workflowAllowsDispatch(
            await manager.findOne(WorkflowRun, {
              where: { id: run.id },
              select: {
                status: true,
                cancelRequested: true,
                errorMessage: true,
                deadlineAt: true,
              },
            }),
          ),
      },
    };
    if (step.kind === 'action')
      await this.advanceAction(activity, step, context);
    else if (step.kind === 'business' || step.kind === 'script')
      await this.businessSteps.advance(step, state, context);
    else if (await context.control.shouldStop())
      finishWorkflowActivity(state, RUN_STATUS.cancelled);
    else if (step.kind === 'human' && state.status === RUN_STATUS.pending) {
      state.preparedInput = bindWorkflowValues(
        step.input,
        context.input,
        context.progress,
        context.iterationIndex,
      );
      state.startedAt = new Date();
      state.status = RUN_STATUS.waiting;
    } else if (step.kind === 'rule')
      await this.advanceRule(activity, step, context);
    await context.control.save();
  }

  /**
   * 按标准活动身份派发或停止原子动作，创建子运行后先保存关联，恢复时只核对同一子运行。
   * @param activity - 本次标准活动及状态。
   * @param step - 固定版本的动作声明。
   * @param context - 同一活动的输入、期限和统一控制端口。
   * @throws 动作端口缺失或调用失败时保留已有持久边界并向恢复层抛出。
   */
  private async advanceAction(
    activity: WorkflowBpmnActivity,
    step: Extract<WorkflowBpmnStep, { kind: 'action' }>,
    context: WorkflowActivityContext,
  ): Promise<void> {
    requireExecutionState(
      this.tasks,
      WORKFLOW_EXECUTION_ERROR.actionUnavailable,
    );
    const state = activity.state;
    const stop = await context.control.shouldStop();
    if (stop && !state.taskRunId) {
      finishWorkflowActivity(state, RUN_STATUS.cancelled);
      return;
    }
    if (!state.taskRunId) {
      const child = await this.tasks.start({
        taskRef: step.taskRef,
        executionKey: `bpmn-${context.runId}-${automationDigest(context.executionId)}`,
        input: bindWorkflowValues(
          step.input,
          context.input,
          context.progress,
          context.iterationIndex,
        ),
        parentRunId: context.runId,
        nodeId: automationDigest(context.executionId),
        deadlineAt: context.deadlineAt,
      });
      state.taskRunId = child.runId;
      state.startedAt = new Date();
      await context.control.save();
    }
    let child: Awaited<ReturnType<TaskExecutionPort['read']>>;
    if (stop) child = await this.tasks.cancel(state.taskRunId);
    else child = await this.tasks.read(state.taskRunId);
    state.status = RUN_STATUS.waiting;
    state.wakeAt = new Date(
      Date.now() + WORKFLOW_EXECUTION_TIMING.actionPollMs,
    );
    if (
      child.status !== RUN_STATUS.succeeded &&
      child.status !== RUN_STATUS.failed &&
      child.status !== RUN_STATUS.cancelled
    )
      return;
    let status = child.status;
    if (!stop && status === RUN_STATUS.cancelled) status = RUN_STATUS.failed;
    state.outputValues = child.output;
    state.errorMessage = child.error;
    finishWorkflowActivity(state, status);
  }

  /**
   * 对当前活动的固定规则求值，明确业务拒绝进入失败，数据库及未知错误继续交给恢复层。
   * @param activity - 保存当前规则执行结果的活动。
   * @param step - 已发布的规则引用和输入映射。
   * @param context - 标准引擎给出的本次输入与循环快照。
   * @throws 非业务拒绝的异常原样传递，不能伪造规则失败。
   */
  private async advanceRule(
    activity: WorkflowBpmnActivity,
    step: Extract<WorkflowBpmnStep, { kind: 'rule' }>,
    context: WorkflowActivityContext,
  ): Promise<void> {
    const state = activity.state;
    state.startedAt = new Date();
    try {
      const result = await this.rules.evaluate(
        step.ruleRef,
        bindWorkflowValues(
          step.input,
          context.input,
          context.progress,
          context.iterationIndex,
        ),
      );
      state.outputValues = { result: result.result };
      finishWorkflowActivity(state, RUN_STATUS.succeeded);
    } catch (error) {
      if (!isAutomationRejection(error)) throw error;
      state.errorMessage = WORKFLOW_EXECUTION_ERROR.ruleRejected;
      finishWorkflowActivity(state, RUN_STATUS.failed);
    }
  }

  /**
   * 逐一确认被标准事件或外部请求取消的脚本已退出，保留无法确认退出的活动。
   * @param run - 当前流程实例。
   * @param activities - 含取消意图的全部活动账本。
   * @param manager - 持久化取消回执的数据库连接。
   */
  private async stopActivities(
    run: WorkflowRun,
    activities: WorkflowBpmnActivity[],
    manager: EntityManager,
  ): Promise<void> {
    for (const activity of activities) {
      if (
        !activity.cancelRequested ||
        activity.delivered ||
        !RUN_STATUS_GROUP.activityOpen.includes(activity.state.status)
      )
        continue;
      await this.advanceActivity(run, activity, manager, true);
    }
  }

  /**
   * 将引擎已接收的标准活动输出投影到统一参数映射，不读取尚未提交的脚本结果。
   * @param outputs - 恢复快照中按标准元素标识保存的输出。
   * @returns 与现有业务脚本参数绑定兼容的只读进度。
   */
  private progress(
    outputs: Record<string, Record<string, unknown>>,
  ): Map<string, WorkflowNodeProgress> {
    return new Map(
      Object.entries(outputs).map(([id, output]) => [
        id,
        { status: RUN_STATUS.succeeded, output },
      ]),
    );
  }
}
