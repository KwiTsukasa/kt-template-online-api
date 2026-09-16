import { createHash } from 'node:crypto';
import { Engine, type BpmnEngineExecutionState } from 'bpmn-engine';
import { ServiceTask, Task, Timers } from 'bpmn-elements';
import {
  KT_BPMN_EXPRESSION,
  KT_BPMN_MODDLE,
  type WorkflowBpmnModel,
  type WorkflowBpmnStep,
} from '../contract/workflow-bpmn.types';
import { evaluateBpmnExpression, type BpmnExpression } from '../domain/workflow-bpmn-expression';
import { readWorkflowBpmnExtension } from '../domain/workflow-bpmn.policy';
import { WorkflowMultiInstance, WorkflowStandardLoop } from './workflow-bpmn-loop';

export interface WorkflowBpmnCheckpoint {
  modelSha256: string;
  engine: BpmnEngineExecutionState;
  activityScopes: Record<string, string[]>;
  outputs: Record<string, Record<string, unknown>>;
}

export interface WorkflowBpmnJob {
  elementId: string;
  name?: string;
  executionId: string;
  index?: number;
  step: WorkflowBpmnStep;
  variables: Record<string, unknown>;
  parentExecutionIds: string[];
  submission?: { actorId: string; hash: string; submittedAt: string };
}

export interface WorkflowBpmnCompletion {
  executionId: string;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface WorkflowBpmnTransition {
  event: string;
  elementId: string;
  executionId: string;
  type: string;
}

export interface WorkflowBpmnActiveActivity {
  nodeId: string;
  executionId: string;
  name: string;
  type: string;
}

/**
 * 只推进 BPMN 令牌至持久边界；服务任务转为待执行记录，真实脚本仍由工作流步骤执行层派发。
 * @param model - 已校验并固定发布版本的 BPMN 模型。
 * @param checkpoint - 同一结构化模型 上次持久化的完整引擎快照，首次为空。
 * @param variables - 首次执行的业务输入与变量，恢复时使用快照。
 * @param completions - 已由工作流核验的准确活动实例结果。
 * @param signals - 已通过业务权限检查的人工或消息活动实例信号。
 * @returns 下一份快照、待执行实例、取消实例与本次状态事件；返回前清除所有临时计时器。
 * @throws 快照不属于当前结构化模型、扩展配置不合法或同步推进超限时拒绝推进。
 */
export async function advanceWorkflowBpmn(
  model: WorkflowBpmnModel,
  checkpoint: WorkflowBpmnCheckpoint | null,
  variables: Record<string, unknown>,
  completions: WorkflowBpmnCompletion[] = [],
  signals: Array<{ executionId: string; id: string; [key: string]: unknown }> = [],
) {
  const modelSha256 = createHash('sha256').update(JSON.stringify(model.definition.model)).digest('hex');
  if (checkpoint && checkpoint.modelSha256 !== modelSha256) throw new Error('BPMN 恢复快照与发布版本不一致');
  const completed = new Map(completions.map((result) => [result.executionId, result]));
  if (completed.size !== completions.length) throw new Error('同一 BPMN 活动实例不能提交两份结果');
  const jobs = new Map<string, WorkflowBpmnJob>();
  const cancelled = new Set<string>();
  const deliveries: Array<() => void> = [];
  const transitions: WorkflowBpmnTransition[] = [];
  const activityScopes = new Map<string, string[]>(Object.entries(checkpoint?.activityScopes ?? {}));
  const outputs = structuredClone(checkpoint?.outputs ?? {});
  let failure: Error | null = null;
  let ended = false;
  const timers = new Timers({ setTimeout: () => null, clearTimeout: () => undefined } as any);

  class HostStep {
    private executionId = '';
    constructor(private readonly activity: any) {}

    /**
     * 将标准任务的当前活动实例转为工作流步骤记录，重放只消费该实例的已核验结果。
     * @param executionMessage - BPMN 引擎当前实例及循环索引。
     * @param callback - 向 BPMN 引擎提交该实例的完成或业务错误。
     * @returns 回调结果或等待后续持久结果。
     */
    execute(executionMessage: any, callback: (error?: Error | null, output?: unknown) => void) {
      const elementId = this.activity.id;
      this.executionId = executionMessage.content.executionId;
      const step = readWorkflowBpmnExtension<WorkflowBpmnStep>(model.elements[elementId], 'kt:Step');
      if (!step) return callback(new Error(`活动 ${elementId} 未配置工作流步骤`));
      const result = completed.get(this.executionId);
      if (result) {
        completed.delete(this.executionId);
        deliveries.push(() => {
          if (result.error) return callback(Object.assign(new Error(result.error.message), { code: result.error.code }));
          const output = result.output ?? {};
          const environment = this.activity.environment;
          outputs[elementId] = output;
          environment.assignVariables({ outputs });
          callback(null, output);
        });
        return;
      }
      jobs.set(this.executionId, {
        elementId,
        executionId: this.executionId,
        index: executionMessage.content.index,
        step,
        variables: { input: structuredClone(this.activity.environment.variables.input ?? {}), outputs: structuredClone(outputs) },
        parentExecutionIds: activityScopes.get(this.executionId) ?? activityScopes.get(executionMessage.content.parent?.executionId) ?? [],
      });
    }

    /** 在中断边界或终止事件撤销实例时保留待取消身份，供工作流确认脚本退出。 */
    discard() {
      if (!this.executionId) return;
      jobs.delete(this.executionId);
      cancelled.add(this.executionId);
    }
  }

  const expressions = {
    resolveExpression: (value: unknown, context: any) => {
      if (typeof value !== 'string') return value;
      if (!value.trim().startsWith('{')) return value;
      const environment = context.environment;
      const data = environment?.variables || {};
      return evaluateBpmnExpression(JSON.parse(value) as BpmnExpression, {
        input: data.input,
        outputs,
        variables: data,
        content: context.content,
      });
    },
  };
  const engine = new Engine({
    moddleContext: { rootElement: model.root, elementsById: model.elements, references: model.references, warnings: [] } as any,
    moddleOptions: { kt: KT_BPMN_MODDLE },
    elements: { ScriptTask: ServiceTask, ManualTask: Task, StandardLoopCharacteristics: WorkflowStandardLoop, MultiInstanceLoopCharacteristics: WorkflowMultiInstance },
    variables,
    expressions,
    timers,
    settings: { enableDummyService: false },
    scripts: {
      register: () => undefined,
      getScript: (language: string, owner: any) => {
        if (language !== KT_BPMN_EXPRESSION) return undefined;
        return { execute: (scope: any, callback: (error: Error | null, value?: unknown) => void) => {
          try { callback(null, expressions.resolveExpression(owner.behaviour.conditionExpression.body, scope)); }
          catch (error) { callback(error as Error); }
        } };
      },
    },
    extensions: { kt: (activity: any) => {
      if (['bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask', 'bpmn:SendTask'].includes(activity.type)) activity.behaviour.Service = HostStep;
    } },
  });
  engine.on('error', (error) => { failure = error; });
  engine.on('end', () => { ended = true; });
  // 引擎对外事件补齐了流程实例父链；任务内部消息仅含静态父元素，不能用于作用域撤销。
  engine.broker.subscribeTmp('event', '#', (event, message) => {
      const content = message.content;
      if (event === 'engine.error') {
        failure = new Error(content.message || 'BPMN 引擎执行失败');
        return;
      }
      if (event.startsWith('activity.') && content.executionId) {
        activityScopes.set(content.executionId, [content.parent, ...(content.parent?.path ?? [])].filter((parent) => parent?.executionId).map((parent) => parent.executionId));
      }
      if (content.type === 'bpmn:UserTask' && event === 'activity.wait') {
        const step = readWorkflowBpmnExtension<WorkflowBpmnStep>(model.elements[content.id], 'kt:Step');
        if (step?.kind !== 'human') throw new Error(`人工活动 ${content.id} 未配置办理契约`);
        const result = completed.get(content.executionId);
        if (result) {
          if (result.error) throw new Error(result.error.message);
          completed.delete(content.executionId);
          deliveries.push(() => engine.execution.signal({ executionId: content.executionId, value: result.output ?? {} }));
        } else jobs.set(content.executionId, {
          elementId: content.id, name: model.elements[content.id]?.name ?? content.id, executionId: content.executionId, index: content.index, step,
          variables: { input: structuredClone(variables.input ?? {}), outputs: structuredClone(outputs) },
          parentExecutionIds: activityScopes.get(content.executionId) ?? [],
        });
      }
      if (content.type === 'bpmn:UserTask' && event === 'activity.end' && content.output?.value) {
        outputs[content.id] = content.output.value;
        for (const execution of engine.execution.definitions) execution.environment.assignVariables({ outputs });
      }
      if (content.type === 'bpmn:UserTask' && event === 'activity.discard') {
        jobs.delete(content.executionId);
        cancelled.add(content.executionId);
      }
      if (!['activity.enter', 'activity.wait', 'activity.end', 'activity.discard', 'activity.error', 'activity.catch', 'process.terminate', 'flow.take'].includes(event)) return;
      if (event === 'activity.end' && content.output !== undefined && model.elements[content.id]?.loopCharacteristics) {
        outputs[content.id] = { ...outputs[content.id], items: content.output };
      }
      transitions.push({ event, elementId: content.id, executionId: content.executionId ?? '', type: content.type });
      if (event === 'process.terminate') {
        for (const job of jobs.values()) {
          if (job.parentExecutionIds.includes(content.parent?.executionId)) {
            jobs.delete(job.executionId);
            cancelled.add(job.executionId);
          }
        }
      }
      if (transitions.length > 10000) {
        failure = new Error('BPMN 单次同步推进超过 10000 次，请检查无等待回环');
        void engine.stop();
      }
    }, { noAck: true });
  try {
    if (checkpoint) {
      engine.recover(checkpoint.engine);
      await engine.resume();
    } else await engine.execute();
    for (const deliver of deliveries) {
      if (deliveries.length > 10000) throw new Error('BPMN 单次结果交付超过安全上限');
      deliver();
    }
    for (const signal of signals) engine.execution.signal(signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const nextWakeAt = timers.executing.reduce<number | null>((earliest, timer) => {
      const due = new Date(timer.owner?.expireAt ?? timer.expireAt).getTime();
      if (earliest === null || due < earliest) return due;
      return earliest;
    }, null);
    const state = await engine.getState();
    const activeActivities: WorkflowBpmnActiveActivity[] = [];
    const pending = [...engine.execution.getPostponed()] as any[];
    const visited = new Set<string>();
    while (pending.length) {
      const activity = pending.shift();
      const executionId = activity.content.executionId;
      if (visited.has(executionId)) continue;
      visited.add(executionId);
      const children = activity.getPostponed?.() ?? [];
      if (children.length) { pending.push(...children); continue; }
      activeActivities.push({ nodeId: activity.id, executionId, name: model.elements[activity.id]?.name ?? activity.id, type: activity.type });
    }
    let status: 'failed' | 'succeeded' | 'waiting' = 'waiting';
    if (failure) status = 'failed';
    else if (ended) status = 'succeeded';
    return {
      checkpoint: { modelSha256, engine: state, activityScopes: Object.fromEntries(activityScopes), outputs },
      jobs: [...jobs.values()],
      cancelledExecutionIds: [...cancelled],
      unconsumedCompletionIds: [...completed.keys()],
      transitions,
      activeActivities,
      nextWakeAt,
      status,
      error: failure?.message ?? null,
    };
  } finally {
    if (engine.execution?.isRunning) await engine.stop();
    for (const timer of timers.executing) timers.clearTimeout(timer);
  }
}
