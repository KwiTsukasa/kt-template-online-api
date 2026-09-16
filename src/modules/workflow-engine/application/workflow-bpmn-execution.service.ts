import { createHash } from 'node:crypto';
import { TASK_EXECUTION, type TaskExecutionPort } from '@/modules/task-execution/contract/task-execution.port';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validateDataValues } from '@/common/automation/data-schema';
import { RULE_ENGINE, type RuleEnginePort } from '@/modules/rule-engine/contract/rule.types';
import type { WorkflowBpmnDefinition } from '../contract/workflow-bpmn.types';
import { bindWorkflowValues, type NodeProgress } from '../domain/workflow-execution.policy';
import { parseWorkflowBpmn } from '../domain/workflow-bpmn.policy';
import { readBpmnContract } from '../domain/workflow-document.policy';
import { advanceWorkflowBpmn, type WorkflowBpmnCompletion } from '../infrastructure/workflow-bpmn.runtime';
import { WorkflowBpmnActivity } from '../infrastructure/persistence/workflow-bpmn.entity';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowBusinessStepService } from './workflow-business-step.service';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import { WorkflowScriptExecutionService } from './workflow-script-execution.service';

@Injectable()
export class WorkflowBpmnExecutionService {
  constructor(
    private readonly processes: WorkflowProcessRegistry,
    @Inject(RULE_ENGINE) private readonly rules: RuleEnginePort,
    @Optional() private readonly scripts?: WorkflowScriptExecutionService,
    @Optional() @Inject(TASK_EXECUTION) private readonly tasks?: TaskExecutionPort,
  ) {}

  /**
   * 在现有流程锁内恢复标准令牌，把引擎快照和新活动意图原子落盘后才派发脚本。
   * @param run - 当前已锁定的工作流实例。
   * @param definition - 实例固定版本的结构化 BPMN 模型。
   * @param manager - 持有同一流程独占连接的数据库管理器。
   * @throws 数据库或标准模型恢复失败时保留原持久边界，交由既有工作流队列恢复。
   */
  async process(run: WorkflowRun, definition: WorkflowBpmnDefinition, manager: EntityManager): Promise<void> {
    const model = await parseWorkflowBpmn(definition);
    const contract = readBpmnContract(model);
    const activities = await manager.findBy(WorkflowBpmnActivity, { runId: run.id });
    const expired = Date.now() >= new Date(run.deadlineAt).getTime();
    if (expired && !run.errorMessage) run.errorMessage = '流程总期限已结束';
    if (run.cancelRequested || run.errorMessage) {
      for (const activity of activities) activity.cancelRequested = true;
      await this.stopActivities(run, activities, manager);
      const active = activities.some((activity) => activity.state.status === 'waiting');
      if (!active) {
        run.status = 'failed';
        if (run.cancelRequested && !run.errorMessage) run.status = 'cancelled';
        run.finishedAt = new Date();
      } else run.status = 'waiting';
      run.nextWakeAt = new Date(Date.now() + 1000);
      await manager.save(WorkflowRun, run);
      return;
    }
    if (!run.bpmnState || run.bpmnState.status === 'waiting') {
      const completions: WorkflowBpmnCompletion[] = activities.filter((activity) => !activity.delivered && !activity.cancelRequested && ['succeeded', 'failed'].includes(activity.state.status)).map((activity) => {
        if (activity.state.status === 'failed') return { executionId: activity.executionId, error: { code: 'WORKFLOW_STEP_FAILED', message: activity.state.errorMessage ?? '工作流步骤失败' } };
        return { executionId: activity.executionId, output: activity.state.outputValues };
      });
      const advanced = await advanceWorkflowBpmn(model, run.bpmnState?.checkpoint ?? null, { input: run.inputValues }, completions);
      if (advanced.unconsumedCompletionIds.length) throw new Error('BPMN 快照无法消费已保存的活动结果');
      run.bpmnState = {
        checkpoint: advanced.checkpoint,
        status: advanced.status,
        error: advanced.error,
        nextWakeAt: advanced.nextWakeAt,
        outputs: advanced.checkpoint.outputs,
        activeActivities: advanced.activeActivities,
        transitions: [...(run.bpmnState?.transitions ?? []), ...advanced.transitions].slice(-2000),
      };
      const byExecution = new Map(activities.map((activity) => [activity.executionId, activity]));
      for (const job of advanced.jobs) {
        if (byExecution.has(job.executionId)) continue;
        const visit = activities.filter((activity) => activity.elementId === job.elementId).length + 1;
        const activity = manager.create(WorkflowBpmnActivity, {
          runId: run.id, executionId: job.executionId, elementId: job.elementId, job, delivered: false, cancelRequested: false,
          state: {
            runId: run.id, nodeId: job.elementId, status: 'pending', visit, loopIteration: job.index ?? 0, loopPath: {},
            taskRunId: null, businessReceipt: null, preparedInput: null, scriptAttempts: null, selectedPorts: [], outputValues: {},
            errorMessage: null, wakeAt: null, startedAt: null, finishedAt: null,
          },
        });
        activities.push(activity);
        byExecution.set(activity.executionId, activity);
      }
      for (const completion of completions) byExecution.get(completion.executionId).delivered = true;
      for (const id of advanced.cancelledExecutionIds) {
        const activity = byExecution.get(id);
        if (activity) activity.cancelRequested = true;
      }
      if (advanced.status === 'failed') {
        for (const activity of activities) if (!activity.delivered) activity.cancelRequested = true;
      }
      await manager.transaction(async (transaction) => {
        if (activities.length) await transaction.save(WorkflowBpmnActivity, activities);
        await transaction.update(WorkflowRun, { id: run.id }, { bpmnState: run.bpmnState, status: 'waiting' });
      });
    }
    // 标准事件已撤销令牌，但外部脚本退出必须另行确认，确认前不派发下游副作用。
    await this.stopActivities(run, activities, manager);
    if (activities.some((activity) => activity.cancelRequested && activity.state.status === 'waiting')) {
      await manager.update(WorkflowRun, { id: run.id }, { status: 'waiting', nextWakeAt: new Date(Date.now() + 1000) });
      return;
    }
    if (run.bpmnState.status !== 'waiting') {
      if (run.bpmnState.status === 'failed') {
        run.status = 'failed';
        run.errorMessage = run.bpmnState.error ?? 'BPMN 流程执行失败';
      } else {
        try {
          const output = validateDataValues(contract.outputSchema, bindWorkflowValues(contract.output, run.inputValues, this.progress(run.bpmnState.outputs)));
          if (run.businessContext) await this.processes.resolve(run.businessContext.processRef).complete({ business: run.businessContext, input: run.inputValues, output });
          run.status = 'succeeded';
          run.outputValues = output;
        } catch {
          run.status = 'failed';
          run.errorMessage = '流程输出或业务完成验收失败';
        }
      }
      run.finishedAt = new Date();
      await manager.update(WorkflowRun, { id: run.id, cancelRequested: false }, { status: run.status, outputValues: run.outputValues, errorMessage: run.errorMessage, finishedAt: run.finishedAt });
      return;
    }
    for (const activity of activities) {
      if (activity.delivered || activity.cancelRequested || !['pending', 'waiting'].includes(activity.state.status)) continue;
      const current = await manager.findOneByOrFail(WorkflowRun, { id: run.id });
      if (current.cancelRequested) break;
      await this.advanceActivity(run, activity, manager, false);
    }
    let wakeAt = Math.min(new Date(run.deadlineAt).getTime(), Date.now() + 30_000);
    if (run.bpmnState.nextWakeAt !== null) wakeAt = Math.min(wakeAt, run.bpmnState.nextWakeAt);
    for (const activity of activities) {
      if (activity.delivered || activity.cancelRequested) continue;
      if (['succeeded', 'failed'].includes(activity.state.status)) wakeAt = Date.now();
      else if (activity.state.wakeAt) wakeAt = Math.min(wakeAt, new Date(activity.state.wakeAt).getTime());
    }
    await manager.update(WorkflowRun, { id: run.id }, { status: 'waiting', nextWakeAt: new Date(wakeAt) });
  }

  /**
   * 调用统一业务步骤执行层或已发布规则，活动结果只属于当前标准实例身份。
   * @param run - 固定业务身份的流程实例。
   * @param activity - 标准引擎生成的活动实例及持久账本。
   * @param manager - 保存执行意图的数据库连接。
   * @param stop - 是否只能停止或核对已经启动的副作用。
   * @throws 内置动作能力未装配时拒绝派发或伪造取消成功。
   */
  private async advanceActivity(run: WorkflowRun, activity: WorkflowBpmnActivity, manager: EntityManager, stop: boolean): Promise<void> {
    const step = activity.job.step;
    const state = activity.state;
    const persist = async () => { await manager.save(WorkflowBpmnActivity, activity); };
    const progress = this.progress(activity.job.variables.outputs as Record<string, Record<string, unknown>> ?? {});
    if (step.kind === 'human') {
      if (stop) { state.status = 'cancelled'; state.finishedAt = new Date(); }
      else if (state.status === 'pending') {
        state.preparedInput = bindWorkflowValues(step.input, run.inputValues, progress, activity.job.index);
        state.startedAt = new Date();
        state.status = 'waiting';
      }
    } else if (step.kind === 'action') {
      if (!this.tasks) throw new Error('内置动作能力未装配');
      if (stop && !state.taskRunId) {
        state.status = 'cancelled';
        state.finishedAt = new Date();
      } else {
        if (!state.taskRunId) {
          const child = await this.tasks.start({
            taskRef: step.taskRef,
            executionKey: `bpmn-${run.id}-${createHash('sha256').update(activity.executionId).digest('hex')}`,
            input: bindWorkflowValues(step.input, run.inputValues, progress, activity.job.index),
            parentRunId: run.id,
            nodeId: createHash('sha256').update(activity.executionId).digest('hex'),
            deadlineAt: new Date(run.deadlineAt).getTime(),
          });
          state.taskRunId = child.runId;
          state.startedAt = new Date();
          await persist();
        }
        let child = await this.tasks.read(state.taskRunId);
        if (stop) child = await this.tasks.cancel(state.taskRunId);
        state.status = 'waiting';
        state.wakeAt = new Date(Date.now() + 500);
        if (['succeeded', 'failed', 'cancelled'].includes(child.status)) {
          state.status = child.status as 'succeeded' | 'failed' | 'cancelled';
          if (!stop && child.status === 'cancelled') state.status = 'failed';
          state.outputValues = child.output;
          state.errorMessage = child.error;
          state.finishedAt = new Date();
        }
      }
    } else if (step.kind !== 'rule') {
      await new WorkflowBusinessStepService(this.processes, this.scripts).advance({ id: activity.elementId, name: activity.elementId, type: 'business', ...step }, state, run, progress, persist, stop, activity.executionId, activity.job.index);
    } else if (stop) {
      state.status = 'cancelled';
      state.finishedAt = new Date();
    } else {
      try {
        state.startedAt = new Date();
        const result = await this.rules.evaluate(step.ruleRef, bindWorkflowValues(step.input, run.inputValues, progress, activity.job.index));
        state.outputValues = { result: result.result };
        state.status = 'succeeded';
      } catch {
        state.status = 'failed';
        state.errorMessage = '固定版本规则求值失败';
      }
      state.finishedAt = new Date();
    }
    await persist();
  }

  /**
   * 逐一确认被标准事件或外部请求取消的脚本已退出，保留无法确认退出的活动。
   * @param run - 当前流程实例。
   * @param activities - 含取消意图的全部活动账本。
   * @param manager - 持久化取消回执的数据库连接。
   */
  private async stopActivities(run: WorkflowRun, activities: WorkflowBpmnActivity[], manager: EntityManager): Promise<void> {
    for (const activity of activities) {
      if (!activity.cancelRequested || activity.delivered || !['pending', 'waiting'].includes(activity.state.status)) continue;
      await this.advanceActivity(run, activity, manager, true);
    }
  }

  /**
   * 将引擎已接收的标准活动输出投影到统一参数映射，不读取尚未提交的脚本结果。
   * @param outputs - 恢复快照中按标准元素标识保存的输出。
   * @returns 与现有业务脚本参数绑定兼容的只读进度。
   */
  private progress(outputs: Record<string, Record<string, unknown>>): Map<string, NodeProgress> {
    return new Map(Object.entries(outputs).map(([id, output]) => [id, { status: 'succeeded', selectedPorts: [], output }]));
  }
}
