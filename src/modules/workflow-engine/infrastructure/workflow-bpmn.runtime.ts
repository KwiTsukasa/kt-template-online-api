import { createHash } from 'node:crypto';
import { Engine, type BpmnEngineExecutionState } from 'bpmn-engine';
import { EscalationEventDefinition, MessageEventDefinition, SignalEventDefinition, Task, Timers } from 'bpmn-elements';
import {
  KT_BPMN_EXPRESSION,
  KT_BPMN_MODDLE,
  type WorkflowBpmnModel,
  type WorkflowBpmnStep,
} from '../contract/workflow-bpmn.types';
import { evaluateBpmnExpression, type BpmnExpression } from '../domain/workflow-bpmn-expression';
import { readWorkflowBpmnExtension } from '../domain/workflow-bpmn.policy';
import { WorkflowMultiInstance, WorkflowStandardLoop } from './workflow-bpmn-loop';
import { WorkflowInclusiveGateway } from './workflow-bpmn-inclusive';
import { WorkflowEventBasedGateway } from './workflow-bpmn-event-gateway';
import { WorkflowComplexGateway } from './workflow-bpmn-complex';
import { WorkflowEventSubProcess } from './workflow-bpmn-event-subprocess';
import { WorkflowConcurrentTask } from './workflow-bpmn-task';
import { repeatingBpmnEvent } from './workflow-bpmn-boundary';
import { bpmnMessageProcess } from '../domain/workflow-bpmn-correlation';

export interface WorkflowBpmnCheckpoint {
  modelSha256: string;
  engine: BpmnEngineExecutionState;
  activityScopes: Record<string, string[]>;
  outputs: Record<string, Record<string, unknown>>;
  entrySelections?: Record<string, string>;
  activityParents?: Record<string, Record<string, string>>;
  messageStart?: { processId: string; entryId: string };
  interruptedScopes?: Record<string, string>;
  boundaryOccurrences?: Record<string, string[]>;
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
  eventDefinitionIndex?: number;
  processExecutionId?: string;
}

/**
 * 根据已核验的活动结果推进令牌，遇到业务任务或等待事件时保存快照，并返回待派发和待取消的实例。
 * @param model - 已校验并固定发布版本的 BPMN 模型。
 * @param checkpoint - 同一结构化模型 上次持久化的完整引擎快照，首次为空。
 * @param variables - 首次执行的业务输入与变量，恢复时使用快照。
 * @param completions - 已由工作流核验的准确活动实例结果。
 * @param signals - 已通过业务权限检查的人工或消息活动实例信号。
 * @param messageStart - 首条消息已经匹配的顶层启动组，恢复时使用快照中的选择。
 * @returns 下一份快照、待执行和取消实例、未消费信号与状态事件；返回前清除临时计时器。
 * @throws 快照不匹配、重复提交结果、扩展配置不合法或同步推进超限时拒绝推进。
 */
export async function advanceWorkflowBpmn(
  model: WorkflowBpmnModel,
  checkpoint: WorkflowBpmnCheckpoint | null,
  variables: Record<string, unknown>,
  completions: WorkflowBpmnCompletion[] = [],
  signals: Array<{ executionId: string; id: string; [key: string]: unknown }> = [],
  messageStart?: { processId: string; entryId: string },
) {
  const modelSha256 = createHash('sha256').update(JSON.stringify(model.definition.model)).digest('hex');
  if (checkpoint && checkpoint.modelSha256 !== modelSha256) throw new Error('BPMN 恢复快照与发布版本不一致');
  const selectedStart = checkpoint?.messageStart ?? messageStart;
  const entrySelections = { ...checkpoint?.entrySelections };
  const activityParents = new Map(Object.entries(checkpoint?.activityParents ?? {}));
  const interruptedScopes = { ...checkpoint?.interruptedScopes };
  const boundaryOccurrences = structuredClone(checkpoint?.boundaryOccurrences ?? {});
  const entryGroups = new Map<string, { entryId: string; scopeId: string }>();
  const elements = Object.values(model.elements);
  for (const element of elements) {
    if (!element.$parent?.id || element.$parent.triggeredByEvent) continue;
    if (element.$type === 'bpmn:StartEvent' || (element.$type === 'bpmn:ReceiveTask' && element.instantiate && !elements.some((flow) => flow.$type === 'bpmn:SequenceFlow' && flow.targetRef === element))) {
      entryGroups.set(element.id, { entryId: element.id, scopeId: element.$parent.id });
    }
    if (element.$type === 'bpmn:EventBasedGateway' && element.instantiate) {
      const group = { entryId: element.id, scopeId: element.$parent.id };
      entryGroups.set(element.id, group);
      for (const flow of elements) if (flow.$type === 'bpmn:SequenceFlow' && flow.sourceRef === element) entryGroups.set(flow.targetRef.id, group);
    }
  }
  const completed = new Map(completions.map((result) => [result.executionId, result]));
  if (completed.size !== completions.length) throw new Error('同一 BPMN 活动实例不能提交两份结果');
  const jobs = new Map<string, WorkflowBpmnJob>();
  const cancelled = new Set<string>();
  const deliveries: Array<() => void> = [];
  const transitions: WorkflowBpmnTransition[] = [];
  const unconsumedSignalIds: string[] = [];
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
        parentExecutionIds: (activityScopes.get(this.executionId) ?? activityScopes.get(executionMessage.content.parent?.executionId) ?? []).filter((id) => !executionMessage.content.ktTaskInstance || id !== executionMessage.content.parent?.executionId),
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
  const expressionScript = (body: string) => ({
    execute: (scope: any, callback: (error: Error | null, value?: unknown) => void) => {
      try { callback(null, expressions.resolveExpression(body, scope)); }
      catch (error) { callback(error as Error); }
    },
  });
  // 黑盒参与者的外部消息由工作流消息端口接收、发送任务派发；令牌引擎只连接模型内实际存在的流程。
  // 上游序列化器假定所有参与者都有 processRef，直接传入合法黑盒泳池会在启动前崩溃。
  const executionRoot = Object.create(model.root);
  executionRoot.rootElements = (model.root.rootElements ?? []).filter((element) => element.$type !== 'bpmn:CorrelationProperty').map((element) => {
    if (selectedStart && element.$type === 'bpmn:Process' && element.id !== selectedStart.processId) {
      const process = Object.create(element);
      process.isExecutable = false;
      return process;
    }
    if (element.$type !== 'bpmn:Collaboration') return element;
    const collaboration = Object.create(element);
    collaboration.messageFlows = (element.messageFlows ?? []).filter((flow) =>
      ![flow.sourceRef, flow.targetRef].some((endpoint) => endpoint?.$type === 'bpmn:Participant' && !endpoint.processRef));
    return collaboration;
  });
  const engine = new Engine({
    moddleContext: { rootElement: executionRoot, elementsById: model.elements, references: model.references, warnings: [] } as any,
    moddleOptions: { kt: KT_BPMN_MODDLE },
    elements: { SignalEventDefinition: repeatingBpmnEvent(SignalEventDefinition, boundaryOccurrences), MessageEventDefinition: repeatingBpmnEvent(MessageEventDefinition, boundaryOccurrences), EscalationEventDefinition: repeatingBpmnEvent(EscalationEventDefinition, boundaryOccurrences), ServiceTask: WorkflowConcurrentTask, BusinessRuleTask: WorkflowConcurrentTask, SendTask: WorkflowConcurrentTask, ScriptTask: WorkflowConcurrentTask, UserTask: WorkflowConcurrentTask, ManualTask: Task, SubProcess: WorkflowEventSubProcess, InclusiveGateway: WorkflowInclusiveGateway, ComplexGateway: WorkflowComplexGateway, EventBasedGateway: WorkflowEventBasedGateway, StandardLoopCharacteristics: WorkflowStandardLoop, MultiInstanceLoopCharacteristics: WorkflowMultiInstance },
    variables,
    expressions,
    timers,
    settings: { enableDummyService: false },
    scripts: {
      register: (owner: any) => {
        if (owner.behaviour?.scriptFormat !== KT_BPMN_EXPRESSION) return undefined;
        return expressionScript(owner.behaviour.script);
      },
      getScript: (language: string, owner: any) => {
        if (language !== KT_BPMN_EXPRESSION) return undefined;
        return expressionScript(owner.behaviour.conditionExpression.body);
      },
    },
    extensions: { kt: (activity: any) => {
      if (['bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask', 'bpmn:SendTask'].includes(activity.type)) activity.behaviour.Service = HostStep;
      const group = entryGroups.get(activity.id);
      return {
        activate: () => {
          if (activity.type === 'bpmn:BoundaryEvent' && activity.behaviour.cancelActivity === false && activity.eventDefinitions?.some((event: any) => ['bpmn:SignalEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:EscalationEventDefinition'].includes(event.type))) {
            activity.broker.subscribeTmp('execution', 'execute.completed', (_event, message) => {
              if (!message.fields.redelivered && message.content.isDefinitionScope) activity.broker.publish('execution', 'execute.repeat', { ...message.content, repeat: 1 });
            }, { consumerTag: '_kt-boundary-repeat', priority: 1000, noAck: true });
          }
          // 完成消息先于循环条件和出口求值；activity.end 已晚于后继令牌传播。
          activity.broker.subscribeTmp('execution', 'execute.completed', (_event, message) => {
            const content = message.content;
            const output = content.output;
            if (output === undefined) return;
            if (activity.type === 'bpmn:UserTask' && output?.value) outputs[activity.id] = output.value;
            if (output?.workflowMessage && output.values) outputs[activity.id] = output.values;
            if (content.isRootScope && activity.behaviour.loopCharacteristics) outputs[activity.id] = { ...outputs[activity.id], items: output };
            activity.environment.assignVariables({ outputs });
          }, { consumerTag: '_kt-activity-output', priority: 1000, noAck: true });
          if (selectedStart && group?.scopeId === selectedStart.processId && group.entryId !== selectedStart.entryId) {
            activity.broker.subscribeOnce('event', 'activity.enter', () => activity.getApi().discard(), { consumerTag: '_kt-message-start', priority: 1000 });
          }
        },
        deactivate: () => {
          activity.broker.cancel('_kt-activity-output');
          activity.broker.cancel('_kt-message-start');
          activity.broker.cancel('_kt-boundary-repeat');
        },
      };
    } },
  });
  const pendingActivities = () => {
    const pending = [...engine.execution.getPostponed()] as any[];
    const activities: any[] = [];
    const visited = new Set<string>();
    const parentExecutions = new Set<string>();
    while (pending.length) {
      const activity = pending.shift();
      if (visited.has(activity.content.executionId)) continue;
      visited.add(activity.content.executionId);
      if (activity.content.parent?.executionId) parentExecutions.add(activity.content.parent.executionId);
      pending.push(...(activity.getExecuting?.() ?? []));
      const children = activity.getPostponed?.() ?? [];
      if (children.length) pending.push(...children);
      else activities.push(activity);
    }
    return activities.filter((activity) => !parentExecutions.has(activity.content.executionId));
  };
  const discardOtherEntries = () => {
    if (!engine.execution) return;
    for (const activity of pendingActivities()) {
      const group = entryGroups.get(activity.id);
      if (!group) continue;
      const parent = activity.content.parent;
      const scope = [parent, ...(parent?.path ?? [])].find((item) => item?.id === group.scopeId);
      let executionId = activity.content.executionId;
      if (activity.content.isDefinitionScope) executionId = parent.executionId;
      const scopeExecutionId = scope?.executionId ?? activityScopes.get(executionId)?.[0];
      const selected = entrySelections[scopeExecutionId];
      if (!selected || selected === group.entryId) continue;
      activity.owner.getApi({ fields: activity.fields, properties: activity.messageProperties, content: { ...activity.content, executionId } }).discard();
    }
  };
  const discardInterruptedScopes = () => {
    const pending = [...engine.execution.getPostponed()] as any[];
    const visited = new Set<string>();
    while (pending.length) {
      const activity = pending.shift();
      const content = activity.content;
      if (visited.has(content.executionId)) continue;
      visited.add(content.executionId);
      const handler = interruptedScopes[content.parent?.executionId];
      if (handler && content.id !== handler) {
        activity.discard();
        continue;
      }
      pending.push(...(activity.getExecuting?.() ?? []), ...(activity.getPostponed?.() ?? []));
    }
  };
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
        activityParents.set(content.executionId, Object.fromEntries([content.parent, ...(content.parent?.path ?? [])].filter((parent) => parent?.executionId).map((parent) => [parent.id, parent.executionId])));
      }
      if (event === 'activity.end' && model.elements[content.id]?.$type !== 'bpmn:EventBasedGateway') {
        const element = model.elements[content.id];
        if (element?.$type === 'bpmn:StartEvent' && element.$parent?.triggeredByEvent && element.isInterrupting !== false) {
          const parents = [content.parent, ...(content.parent?.path ?? [])];
          const scope = parents.find((parent) => parent.id === element.$parent.$parent?.id);
          if (scope?.executionId) interruptedScopes[scope.executionId] = element.$parent.id;
        }
        const group = entryGroups.get(content.id);
        const parent = content.parent;
        const scope = [parent, ...(parent?.path ?? [])].find((item) => item?.id === group?.scopeId);
        if (group && scope?.executionId && !entrySelections[scope.executionId]) {
          entrySelections[scope.executionId] = group.entryId;
          discardOtherEntries();
        }
      }
      if (event === 'activity.wait' && entryGroups.has(content.id)) deliveries.push(discardOtherEntries);
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
          parentExecutionIds: (activityScopes.get(content.executionId) ?? []).filter((id) => !content.ktTaskInstance || id !== content.parent?.executionId),
        });
      }
      if (content.type === 'bpmn:UserTask' && event === 'activity.discard') {
        jobs.delete(content.executionId);
        cancelled.add(content.executionId);
      }
      if (event === 'activity.discard') {
        for (const job of jobs.values()) {
          if (!job.parentExecutionIds.includes(content.executionId)) continue;
          jobs.delete(job.executionId);
          cancelled.add(job.executionId);
        }
      }
      if (!['activity.enter', 'activity.wait', 'activity.end', 'activity.discard', 'activity.error', 'activity.catch', 'process.terminate', 'flow.take'].includes(event)) return;
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
    discardOtherEntries();
    for (const deliver of deliveries) {
      if (deliveries.length > 10000) throw new Error('BPMN 单次结果交付超过安全上限');
      deliver();
      discardInterruptedScopes();
    }
    for (const signal of signals) {
      const activity = pendingActivities().find((item) => item.id === signal.id && item.content.executionId === signal.executionId);
      if (!activity) {
        unconsumedSignalIds.push(signal.executionId);
        continue;
      }
      activity.signal(signal);
      discardInterruptedScopes();
    }
    if (completions.length || signals.length) {
      for (const activity of pendingActivities()) {
        const element = model.elements[activity.id];
        const definitions = [...(element?.eventDefinitions ?? []), ...(element?.eventDefinitionRef ?? [])];
        if (definitions.some((definition: any) => definition.$type === 'bpmn:ConditionalEventDefinition')) activity.signal({});
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    discardInterruptedScopes();
    const nextWakeAt = timers.executing.reduce<number | null>((earliest, timer) => {
      const due = new Date(timer.owner?.expireAt ?? timer.expireAt).getTime();
      if (earliest === null || due < earliest) return due;
      return earliest;
    }, null);
    const state = await engine.getState();
    const activeActivities: WorkflowBpmnActiveActivity[] = [];
    for (const activity of pendingActivities()) {
      const executionId = activity.content.executionId;
      const active: WorkflowBpmnActiveActivity = { nodeId: activity.id, executionId, name: model.elements[activity.id]?.name ?? activity.id, type: activity.content.type };
      if (activity.content.isDefinitionScope) active.eventDefinitionIndex = activity.content.index;
      const process = bpmnMessageProcess(model.elements[activity.id]);
      const parents = activityParents.get(executionId) ?? activityParents.get(activity.content.parent?.executionId);
      if (process && parents?.[process.id]) active.processExecutionId = parents[process.id];
      activeActivities.push(active);
    }
    const activeExecutionIds = new Set(activeActivities.map((activity) => activity.executionId));
    for (const job of jobs.values()) {
      if (activeExecutionIds.has(job.executionId)) continue;
      jobs.delete(job.executionId);
      cancelled.add(job.executionId);
    }
    let status: 'failed' | 'succeeded' | 'waiting' = 'waiting';
    if (failure) status = 'failed';
    else if (ended) status = 'succeeded';
    return {
      checkpoint: { modelSha256, engine: state, activityScopes: Object.fromEntries(activityScopes), outputs, entrySelections, activityParents: Object.fromEntries(activityParents), messageStart: selectedStart, interruptedScopes, boundaryOccurrences },
      jobs: [...jobs.values()],
      cancelledExecutionIds: [...cancelled],
      unconsumedCompletionIds: [...completed.keys()],
      unconsumedSignalIds,
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
