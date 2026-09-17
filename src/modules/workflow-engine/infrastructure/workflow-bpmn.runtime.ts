import { requireExecutionState } from '@/common/automation/validation';
import { BPMN_TRACKED_EVENTS } from '../constants/bpmn-runtime';
import { BPMN_EXCHANGE, BPMN_ROUTING } from '../constants/bpmn-runtime';
import {
  BPMN_KIND_GROUPS,
  BPMN_EXTENSION,
  BPMN_TYPE,
  KT_BPMN_EXPRESSION,
  KT_BPMN_MODDLE,
  WORKFLOW_BPMN_LIMITS,
} from '@/modules/workflow-engine/constants/bpmn';
import { automationDigest } from '@/common/automation/content-digest';
import { RUN_STATUS } from '@/common/automation/constants/run-status';

import {
  Engine,
  type BpmnEngineExecutionState,
  type BpmnEngineOptions,
} from 'bpmn-engine';
import {
  Timers,
  type Activity,
  type ElementBase,
  type ElementBrokerMessage,
  type ElementMessageContent,
  type ExecutionScope,
  type IApi,
} from 'bpmn-elements';

type WorkflowActivityApi = IApi<ElementBase | Activity> & {
  messageProperties?: ElementBrokerMessage['properties'];
};
type WorkflowScriptOwner = {
  id?: string;
  behaviour: Activity['behaviour'] & {
    scriptFormat?: string;
    script?: string;
    conditionExpression?: { body: string };
  };
};
import {
  type WorkflowBpmnModel,
  type WorkflowBpmnStep,
} from '../contract/workflow-bpmn.types';
import {
  evaluateBpmnExpression,
  type BpmnExpression,
} from '../domain/workflow-bpmn-expression';
import { readWorkflowBpmnExtension } from '../domain/workflow-bpmn.policy';
import { bpmnMessageProcess } from '../domain/workflow-bpmn-correlation';
import { WorkflowBpmnModelIndex } from '../domain/workflow-bpmn-index';

import { createWorkflowBpmnElements } from './workflow-bpmn-elements';
import { WorkflowBpmnScopeIndex } from './workflow-bpmn-scope-index';
import { workflowBpmnParentChain } from './workflow-bpmn-scope';

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
 * 为人工和脚本步骤截取同一结构的数据副本，步骤修改参数不会反向污染引擎检查点。
 * @param input - 当前引擎作用域已恢复的业务输入。
 * @param outputs - 当前推进阶段已确认的节点结果。
 * @returns 与引擎状态分离的步骤输入及结果视图。
 */
function snapshotWorkflowBpmnVariables(
  input: unknown,
  outputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return {
    input: structuredClone(input ?? {}),
    outputs: structuredClone(outputs),
  };
}

/**
 * 补偿处理器读取自己的完成时快照，普通执行继续使用本次推进确认的最新结果。
 * @param variables - 活动实际所属作用域的变量。
 * @param outputs - 正向流程已确认的公共结果视图。
 * @returns 当前作用域可读写的节点结果集合。
 */
function workflowBpmnScopeOutputs(
  variables: Record<string, unknown>,
  outputs: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  if (variables.ktCompensationScope)
    return (variables.outputs ?? {}) as Record<string, Record<string, unknown>>;
  return outputs;
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
  signals: Array<{
    executionId: string;
    id: string;
    [key: string]: unknown;
  }> = [],
  messageStart?: { processId: string; entryId: string },
) {
  return new WorkflowBpmnRuntime(
    model,
    checkpoint,
    variables,
    completions,
    signals,
    messageStart,
  ).advance();
}

class WorkflowBpmnRuntime {
  private readonly waitingSignals = new WorkflowBpmnScopeIndex<{
    executionId: string;
    parentExecutionIds: string[];
    api: WorkflowActivityApi;
  }>();
  private readonly HostStep: ReturnType<WorkflowBpmnRuntime['createHostStep']>;
  private readonly modelSha256: string;
  private readonly selectedStart: { processId: string; entryId: string };
  private readonly entrySelections: { [x: string]: string };
  private readonly activityParents: Map<string, Record<string, string>>;
  private readonly interruptedScopes: { [x: string]: string };
  private readonly boundaryOccurrences: Record<string, string[]>;
  private readonly entryGroups: Map<
    string,
    { entryId: string; scopeId: string }
  >;
  private readonly modelIndex: WorkflowBpmnModelIndex;
  private readonly completed: Map<string, WorkflowBpmnCompletion>;
  private readonly jobs: WorkflowBpmnScopeIndex<WorkflowBpmnJob>;
  private readonly humanVariables: Map<string, Record<string, unknown>>;
  private readonly cancelled: Set<string>;
  private readonly deliveries: Array<() => void>;
  private readonly transitions: WorkflowBpmnTransition[];
  private readonly unconsumedSignalIds: string[];
  private readonly activityScopes: Map<string, string[]>;
  private readonly outputs: Record<string, Record<string, unknown>>;
  private failure: Error | null;
  private ended: boolean;
  private readonly timers: Timers;
  private interruptionDirty: boolean;
  private readonly engine: Engine;
  constructor(
    private readonly model: WorkflowBpmnModel,
    private readonly checkpoint: WorkflowBpmnCheckpoint | null,
    private readonly variables: Record<string, unknown>,
    private readonly completions: WorkflowBpmnCompletion[] = [],
    private readonly signals: Array<{
      executionId: string;
      id: string;
      [key: string]: unknown;
    }> = [],
    private readonly messageStart?: { processId: string; entryId: string },
  ) {
    this.modelSha256 = automationDigest(
      JSON.stringify(this.model.definition.model),
    );
    requireExecutionState(
      !this.checkpoint || this.checkpoint.modelSha256 === this.modelSha256,
      'BPMN 恢复快照与发布版本不一致',
    );
    this.selectedStart = this.checkpoint?.messageStart ?? this.messageStart;
    this.entrySelections = { ...this.checkpoint?.entrySelections };
    this.activityParents = new Map(
      Object.entries(this.checkpoint?.activityParents ?? {}),
    );
    this.interruptedScopes = { ...this.checkpoint?.interruptedScopes };
    this.boundaryOccurrences = structuredClone(
      this.checkpoint?.boundaryOccurrences ?? {},
    );
    this.entryGroups = new Map<string, { entryId: string; scopeId: string }>();
    this.modelIndex = new WorkflowBpmnModelIndex(this.model);
    for (const element of this.modelIndex.elements) {
      if (!element.$parent?.id || element.$parent.triggeredByEvent) continue;
      if (
        element.$type === BPMN_TYPE.StartEvent ||
        (element.$type === BPMN_TYPE.ReceiveTask &&
          element.instantiate &&
          !this.modelIndex.incoming.has(element))
      ) {
        this.entryGroups.set(element.id, {
          entryId: element.id,
          scopeId: element.$parent.id,
        });
      }
      if (
        element.$type === BPMN_TYPE.EventBasedGateway &&
        element.instantiate
      ) {
        const group = { entryId: element.id, scopeId: element.$parent.id };
        this.entryGroups.set(element.id, group);
        for (const flow of this.modelIndex.outgoing.get(element) ?? [])
          this.entryGroups.set(flow.targetRef.id, group);
      }
    }
    this.completed = new Map(
      this.completions.map((result) => [result.executionId, result]),
    );
    requireExecutionState(
      this.completed.size === this.completions.length,
      '同一 BPMN 活动实例不能提交两份结果',
    );
    this.jobs = new WorkflowBpmnScopeIndex<WorkflowBpmnJob>();
    this.humanVariables = new Map<string, Record<string, unknown>>();
    this.cancelled = new Set<string>();
    this.deliveries = [];
    this.transitions = [];
    this.unconsumedSignalIds = [];
    this.activityScopes = new Map<string, string[]>(
      Object.entries(this.checkpoint?.activityScopes ?? {}),
    );
    this.outputs = structuredClone(this.checkpoint?.outputs ?? {});
    this.failure = null;
    this.ended = false;
    this.timers = new Timers({
      setTimeout: () => null,
      clearTimeout: () => undefined,
    });
    this.interruptionDirty = Object.keys(this.interruptedScopes).length > 0;
    this.HostStep = this.createHostStep();
    this.engine = this.createEngine();
    this.observe();
  }
  private readonly expressions = {
    resolveExpression: (
      value: unknown,
      context: Pick<ExecutionScope, 'environment' | 'content'>,
    ) => {
      if (typeof value !== 'string') return value;
      if (!value.trim().startsWith('{')) return value;
      const environment = context.environment;
      const data = environment?.variables || {};
      return evaluateBpmnExpression(JSON.parse(value) as BpmnExpression, {
        input: data.input,
        outputs: workflowBpmnScopeOutputs(data, this.outputs),
        variables: data,
        content: context.content,
      });
    },
  };
  private readonly expressionScript = (body: string) => ({
    execute: (
      scope: ExecutionScope,
      callback: (error: Error | null, value?: unknown) => void,
    ) => {
      try {
        callback(null, this.expressions.resolveExpression(body, scope));
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  private readonly pendingActivities = () => {
    const pending: WorkflowActivityApi[] = [
      ...this.engine.execution.getPostponed(),
    ];
    const activities: WorkflowActivityApi[] = [];
    const visited = new Set<string>();
    const parentExecutions = new Set<string>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const activity = pending[cursor];
      if (visited.has(activity.content.executionId)) continue;
      visited.add(activity.content.executionId);
      if (activity.content.parent?.executionId)
        parentExecutions.add(activity.content.parent.executionId);
      pending.push(...(activity.getExecuting?.() ?? []));
      const children = activity.getPostponed?.() ?? [];
      if (children.length) pending.push(...children);
      else activities.push(activity);
    }
    return activities.filter(
      (activity) => !parentExecutions.has(activity.content.executionId),
    );
  };
  private readonly discardOtherEntries = () => {
    if (!this.engine.execution) return;
    for (const activity of this.pendingActivities()) {
      const group = this.entryGroups.get(activity.id);
      if (!group) continue;
      const parent = activity.content.parent;
      const scope = workflowBpmnParentChain(parent).find(
        (item) => item.id === group.scopeId,
      );
      let executionId = activity.content.executionId;
      if (activity.content.isDefinitionScope) executionId = parent.executionId;
      const scopeExecutionId =
        scope?.executionId ?? this.activityScopes.get(executionId)?.[0];
      const selected = this.entrySelections[scopeExecutionId];
      if (!selected || selected === group.entryId) continue;
      activity.owner
        .getApi({
          fields: activity.fields,
          properties: activity.messageProperties,
          content: { ...activity.content, executionId },
        })
        .discard();
    }
  };
  private readonly discardInterruptedScopes = () => {
    if (!this.interruptionDirty) return;
    this.interruptionDirty = false;
    const pending: WorkflowActivityApi[] = [
      ...this.engine.execution.getPostponed(),
    ];
    const visited = new Set<string>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const activity = pending[cursor];
      const content = activity.content;
      if (visited.has(content.executionId)) continue;
      visited.add(content.executionId);
      const handler = this.interruptedScopes[content.parent?.executionId];
      if (handler && content.id !== handler) {
        activity.discard();
        continue;
      }
      pending.push(
        ...(activity.getExecuting?.() ?? []),
        ...(activity.getPostponed?.() ?? []),
      );
    }
  };
  private readonly recordEntryCompletion = (content: ElementMessageContent) => {
    const element = this.model.elements[content.id];
    if (
      element?.$type === BPMN_TYPE.StartEvent &&
      element.$parent?.triggeredByEvent &&
      element.isInterrupting !== false
    ) {
      const parents = workflowBpmnParentChain(content.parent);
      const scope = parents.find(
        (parent) => parent.id === element.$parent.$parent?.id,
      );
      if (scope?.executionId) {
        this.interruptedScopes[scope.executionId] = element.$parent.id;
        this.interruptionDirty = true;
      }
    }
    const group = this.entryGroups.get(content.id);
    const parent = content.parent;
    const scope = workflowBpmnParentChain(parent).find(
      (item) => item.id === group?.scopeId,
    );
    if (
      group &&
      scope?.executionId &&
      !this.entrySelections[scope.executionId]
    ) {
      this.entrySelections[scope.executionId] = group.entryId;
      this.discardOtherEntries();
    }
  };
  /** 建立本轮专属步骤适配器，完成、取消与输出都绑定当前运行状态。
   * @returns 提供给原生服务任务的适配器构造函数。
   */
  private createHostStep() {
    const {
      model,
      completed,
      deliveries,
      outputs,
      jobs,
      activityScopes,
      cancelled,
    } = this;
    class HostStep {
      private executionId = '';
      constructor(private readonly activity: Activity) {}

      /**
       * 将标准任务的当前活动实例转为工作流步骤记录，重放只消费该实例的已核验结果。
       * @param executionMessage - BPMN 引擎当前实例及循环索引。
       * @param callback - 向 BPMN 引擎提交该实例的完成或业务错误。
       * @returns 回调结果或等待后续持久结果。
       */
      execute(
        executionMessage: ElementBrokerMessage,
        callback: (error?: Error | null, output?: unknown) => void,
      ) {
        const elementId = this.activity.id;
        this.executionId = executionMessage.content.executionId;
        const step = readWorkflowBpmnExtension<WorkflowBpmnStep>(
          model.elements[elementId],
          BPMN_EXTENSION.Step,
        );
        if (!step)
          return callback(new Error(`活动 ${elementId} 未配置工作流步骤`));
        const result = completed.get(this.executionId);
        if (result) {
          completed.delete(this.executionId);
          deliveries.push(() => {
            if (result.error)
              return callback(
                Object.assign(new Error(result.error.message), {
                  code: result.error.code,
                }),
              );
            const output = result.output ?? {};
            const environment = this.activity.environment;
            const targetOutputs = workflowBpmnScopeOutputs(
              environment.variables,
              outputs,
            );
            targetOutputs[elementId] = output;
            environment.assignVariables({ outputs: targetOutputs });
            callback(null, output);
          });
          return;
        }
        jobs.set(this.executionId, {
          elementId,
          executionId: this.executionId,
          index: executionMessage.content.index,
          step,
          variables: snapshotWorkflowBpmnVariables(
            this.activity.environment.variables.input,
            workflowBpmnScopeOutputs(
              this.activity.environment.variables,
              outputs,
            ),
          ),
          parentExecutionIds: (
            activityScopes.get(this.executionId) ??
            activityScopes.get(executionMessage.content.parent?.executionId) ??
            []
          ).filter(
            (id) =>
              !executionMessage.content.ktTaskInstance ||
              id !== executionMessage.content.parent?.executionId,
          ),
        });
      }

      /** 在中断边界或终止事件撤销实例时保留待取消身份，供工作流确认脚本退出。 */
      discard() {
        if (!this.executionId) return;
        jobs.delete(this.executionId);
        cancelled.add(this.executionId);
      }
    }
    return HostStep;
  }
  /** 将标准 JSON 模型交给原生令牌引擎，安装本轮脚本、计时器及活动输出扩展。
   * @returns 尚未执行、可恢复本轮检查点的引擎。
   */
  private createEngine(): Engine {
    const executionRoot = Object.create(this.model.root);
    executionRoot.rootElements = (this.model.root.rootElements ?? [])
      .filter((element) => element.$type !== BPMN_TYPE.CorrelationProperty)
      .map((element) => {
        if (
          this.selectedStart &&
          element.$type === BPMN_TYPE.Process &&
          element.id !== this.selectedStart.processId
        ) {
          const process = Object.create(element);
          process.isExecutable = false;
          return process;
        }
        if (element.$type !== BPMN_TYPE.Collaboration) return element;
        const collaboration = Object.create(element);
        collaboration.messageFlows = (element.messageFlows ?? []).filter(
          (flow) =>
            ![flow.sourceRef, flow.targetRef].some(
              (endpoint) =>
                endpoint?.$type === BPMN_TYPE.Participant &&
                !endpoint.processRef,
            ),
        );
        return collaboration;
      });
    return new Engine({
      moddleContext: {
        rootElement: executionRoot,
        elementsById: this.model.elements,
        references: this.model.references,
        warnings: [],
      } as unknown as BpmnEngineOptions['moddleContext'],
      moddleOptions: { kt: KT_BPMN_MODDLE },
      elements: createWorkflowBpmnElements(this.boundaryOccurrences),
      variables: structuredClone(this.variables),
      expressions: this.expressions,
      timers: this.timers,
      settings: { enableDummyService: false },
      scripts: {
        register: (owner: WorkflowScriptOwner) => {
          if (owner.behaviour?.scriptFormat !== KT_BPMN_EXPRESSION)
            return undefined;
          return this.expressionScript(owner.behaviour.script);
        },
        getScript: (language: string, owner: any) => {
          if (language !== KT_BPMN_EXPRESSION) return undefined;
          return this.expressionScript(
            owner.behaviour.conditionExpression.body,
          );
        },
      },
      extensions: {
        kt: (activity: any) => this.extendActivity(activity),
      },
    });
  }
  /** 为当前活动连接工作流步骤、重复边界与输出采集，停用时清理本轮订阅。
   * @param activity - 原生引擎创建的活动对象。
   * @returns 原生扩展的激活和停用回调。
   */
  private extendActivity(activity: any) {
    if (BPMN_KIND_GROUPS.serviceTasks.has(activity.type))
      activity.behaviour.Service = this.HostStep;
    const group = this.entryGroups.get(activity.id);
    return {
      activate: () => {
        if (activity.type === BPMN_TYPE.UserTask)
          activity.broker.subscribeTmp(
            BPMN_EXCHANGE.event,
            BPMN_ROUTING.activityWait,
            (_event, message) => {
              this.humanVariables.set(
                message.content.executionId,
                activity.environment.variables,
              );
            },
            { consumerTag: '_kt-human-scope', priority: 1000, noAck: true },
          );
        if (
          activity.type === BPMN_TYPE.BoundaryEvent &&
          activity.behaviour.cancelActivity === false &&
          activity.eventDefinitions?.some((event) =>
            BPMN_KIND_GROUPS.repeatingEvents.has(event.type),
          )
        ) {
          activity.broker.subscribeTmp(
            BPMN_EXCHANGE.execution,
            BPMN_ROUTING.executeCompleted,
            (_event, message) => {
              if (
                !message.fields.redelivered &&
                message.content.isDefinitionScope
              )
                activity.broker.publish(
                  BPMN_EXCHANGE.execution,
                  BPMN_ROUTING.executeRepeat,
                  {
                    ...message.content,
                    repeat: 1,
                  },
                );
            },
            {
              consumerTag: '_kt-boundary-repeat',
              priority: 1000,
              noAck: true,
            },
          );
        }
        // 完成消息先于循环条件和出口求值；activity.end 已晚于后继令牌传播。
        activity.broker.subscribeTmp(
          BPMN_EXCHANGE.execution,
          BPMN_ROUTING.executeCompleted,
          (_event, message) => {
            const content = message.content;
            const output = content.output;
            if (output === undefined) return;
            const scopeOutputs = workflowBpmnScopeOutputs(
              activity.environment.variables,
              this.outputs,
            );
            if (activity.type === BPMN_TYPE.UserTask && output?.value)
              scopeOutputs[activity.id] = output.value;
            if (output?.workflowMessage && output.values)
              scopeOutputs[activity.id] = output.values;
            if (content.isRootScope && activity.behaviour.loopCharacteristics)
              scopeOutputs[activity.id] = {
                ...scopeOutputs[activity.id],
                items: output,
              };
            activity.environment.assignVariables({ outputs: scopeOutputs });
          },
          {
            consumerTag: '_kt-activity-output',
            priority: 1000,
            noAck: true,
          },
        );
        if (
          this.selectedStart &&
          group?.scopeId === this.selectedStart.processId &&
          group.entryId !== this.selectedStart.entryId
        ) {
          activity.broker.subscribeOnce(
            BPMN_EXCHANGE.event,
            BPMN_ROUTING.activityEnter,
            () => activity.getApi().discard(),
            { consumerTag: '_kt-message-start', priority: 1000 },
          );
        }
      },
      deactivate: () => {
        activity.broker.cancel('_kt-activity-output');
        activity.broker.cancel('_kt-message-start');
        activity.broker.cancel('_kt-boundary-repeat');
        activity.broker.cancel('_kt-human-scope');
      },
    };
  }
  /** 记录引擎事件、精确活动身份及撤销意图，尚未确认的外部任务不会伪装完成。 */
  private observe(): void {
    this.engine.on('error', (error) => {
      this.failure = error;
    });
    this.engine.on('end', () => {
      this.ended = true;
    });
    this.engine.broker.subscribeTmp(
      BPMN_EXCHANGE.event,
      '#',
      (event, message) => this.onEvent(event, message),
      { noAck: true },
    );
  }
  /** 合并原生事件中的活动归属、人工步骤及取消状态，保留有界事件轨迹。
   * @param event - 引擎发布的事件路由。
   * @param message - 带精确活动身份的原生事件。
   * @throws 人工活动缺少契约或已提交错误结果时拒绝推进。
   */
  private onEvent(event: string, message: ElementBrokerMessage): void {
    const content = message.content;
    if (
      event === BPMN_ROUTING.activityEnd ||
      event === BPMN_ROUTING.activityDiscard ||
      event === BPMN_ROUTING.activityCatch ||
      event === BPMN_ROUTING.activityError ||
      event === BPMN_ROUTING.activityLeave
    ) {
      this.waitingSignals.delete(content.executionId);
      this.waitingSignals.cancelScope(content.executionId);
    }
    if (event === BPMN_ROUTING.engineError) {
      this.failure = new Error(content.message || 'BPMN 引擎执行失败');
      return;
    }
    if (
      event === BPMN_ROUTING.activityEnter &&
      this.interruptedScopes[content.parent?.executionId]
    )
      this.interruptionDirty = true;
    if (event.startsWith(BPMN_ROUTING.activityPrefix) && content.executionId) {
      const parents = workflowBpmnParentChain(content.parent).filter(
        (parent) => parent.executionId,
      );
      this.activityScopes.set(
        content.executionId,
        parents.map((parent) => parent.executionId),
      );
      this.activityParents.set(
        content.executionId,
        Object.fromEntries(
          parents.map((parent) => [parent.id, parent.executionId]),
        ),
      );
    }
    if (
      event === BPMN_ROUTING.activityEnd &&
      this.model.elements[content.id]?.$type !== BPMN_TYPE.EventBasedGateway
    ) {
      this.recordEntryCompletion(content);
    }
    if (event === BPMN_ROUTING.activityWait && this.entryGroups.has(content.id))
      this.deliveries.push(this.discardOtherEntries);
    if (
      content.type === BPMN_TYPE.UserTask &&
      event === BPMN_ROUTING.activityWait
    ) {
      this.waitHuman(content);
    }
    if (
      content.type === BPMN_TYPE.UserTask &&
      event === BPMN_ROUTING.activityDiscard
    ) {
      this.jobs.delete(content.executionId);
      this.cancelled.add(content.executionId);
    }
    if (event === BPMN_ROUTING.activityDiscard) {
      this.jobs.cancelScope(content.executionId, this.cancelled);
    }
    if (!BPMN_TRACKED_EVENTS.has(event)) return;
    this.transitions.push({
      event,
      elementId: content.id,
      executionId: content.executionId ?? '',
      type: content.type,
    });
    if (event === BPMN_ROUTING.processTerminate) {
      this.jobs.cancelScope(content.parent?.executionId, this.cancelled);
      this.waitingSignals.cancelScope(content.parent?.executionId);
    }
    if (this.transitions.length > WORKFLOW_BPMN_LIMITS.synchronousTransitions) {
      this.failure = new Error(
        `BPMN 单次同步推进超过 ${WORKFLOW_BPMN_LIMITS.synchronousTransitions} 次，请检查无等待回环`,
      );
      void this.engine.stop();
    }
  }
  /** 把人工等待投影为业务活动，恢复时只消费同一活动身份已保存的办理结果。
   * @param content - 人工等待事件的原生内容。
   * @throws 人工契约缺失或办理结果明确失败时拒绝推进。
   */
  private waitHuman(content: any): void {
    const variables =
      this.humanVariables.get(content.executionId) ??
      this.engine.environment.variables;
    const input = variables.input;
    const step = readWorkflowBpmnExtension<WorkflowBpmnStep>(
      this.model.elements[content.id],
      BPMN_EXTENSION.Step,
    );
    requireExecutionState(
      step?.kind === 'human',
      `人工活动 ${content.id} 未配置办理契约`,
    );
    const result = this.completed.get(content.executionId);
    if (result) {
      requireExecutionState(!result.error, result.error?.message ?? '');
      this.completed.delete(content.executionId);
      this.deliveries.push(() =>
        this.engine.execution.signal({
          executionId: content.executionId,
          value: result.output ?? {},
        }),
      );
    } else
      this.jobs.set(content.executionId, {
        elementId: content.id,
        name: this.model.elements[content.id]?.name ?? content.id,
        executionId: content.executionId,
        index: content.index,
        step,
        variables: snapshotWorkflowBpmnVariables(
          input,
          workflowBpmnScopeOutputs(variables, this.outputs),
        ),
        parentExecutionIds: (
          this.activityScopes.get(content.executionId) ?? []
        ).filter(
          (id) => !content.ktTaskInstance || id !== content.parent?.executionId,
        ),
      });
  }
  /** 推进当前恢复批次并输出检查点，成功与失败路径都停止原生计时器。
   * @returns 本轮快照、派发意图及未消费结果。
   * @throws 原生恢复、配置或同步推进超限时传播错误。
   */
  async advance() {
    try {
      if (this.checkpoint) {
        this.engine.recover(this.checkpoint.engine);
        await this.engine.resume();
      } else await this.engine.execute();
      this.discardOtherEntries();
      for (const deliver of this.deliveries) {
        requireExecutionState(
          !(
            this.deliveries.length > WORKFLOW_BPMN_LIMITS.synchronousTransitions
          ),
          'BPMN 单次结果交付超过安全上限',
        );
        deliver();
        this.discardInterruptedScopes();
      }
      if (this.signals.length) {
        for (const api of this.pendingActivities()) {
          this.waitingSignals.set(api.content.executionId, {
            executionId: api.content.executionId,
            parentExecutionIds: workflowBpmnParentChain(api.content.parent)
              .map((parent) => parent.executionId)
              .filter(Boolean),
            api,
          });
        }
      }
      for (const signal of this.signals) {
        const activity = this.waitingSignals.get(signal.executionId)?.api;
        if (!activity || activity.id !== signal.id) {
          this.unconsumedSignalIds.push(signal.executionId);
          continue;
        }
        this.waitingSignals.delete(signal.executionId);
        activity.signal(signal);
        this.discardInterruptedScopes();
      }
      if (this.completions.length || this.signals.length) {
        for (const activity of this.pendingActivities()) {
          const element = this.model.elements[activity.id];
          if (
            this.modelIndex.events
              .get(element)
              ?.types.has(BPMN_TYPE.ConditionalEventDefinition)
          )
            activity.signal({});
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.discardInterruptedScopes();
      const nextWakeAt = this.timers.executing.reduce<number | null>(
        (earliest, timer) => {
          const due = new Date(
            timer.owner?.expireAt ?? timer.expireAt,
          ).getTime();
          if (earliest === null || due < earliest) return due;
          return earliest;
        },
        null,
      );
      const state = await this.engine.getState();
      const activeActivities: WorkflowBpmnActiveActivity[] = [];
      for (const activity of this.pendingActivities()) {
        const executionId = activity.content.executionId;
        const active: WorkflowBpmnActiveActivity = {
          nodeId: activity.id,
          executionId,
          name: this.model.elements[activity.id]?.name ?? activity.id,
          type: activity.content.type,
        };
        if (activity.content.isDefinitionScope)
          active.eventDefinitionIndex = activity.content.index;
        const process = bpmnMessageProcess(this.model.elements[activity.id]);
        const parents =
          this.activityParents.get(executionId) ??
          this.activityParents.get(activity.content.parent?.executionId);
        if (process && parents?.[process.id])
          active.processExecutionId = parents[process.id];
        activeActivities.push(active);
      }
      const activeExecutionIds = new Set(
        activeActivities.map((activity) => activity.executionId),
      );
      for (const job of this.jobs.values()) {
        if (activeExecutionIds.has(job.executionId)) continue;
        this.jobs.delete(job.executionId);
        this.cancelled.add(job.executionId);
      }
      let status:
        | typeof RUN_STATUS.failed
        | typeof RUN_STATUS.succeeded
        | typeof RUN_STATUS.waiting = RUN_STATUS.waiting;
      if (this.failure) status = RUN_STATUS.failed;
      else if (this.ended) status = RUN_STATUS.succeeded;
      return {
        checkpoint: {
          modelSha256: this.modelSha256,
          engine: state,
          activityScopes: Object.fromEntries(this.activityScopes),
          outputs: this.outputs,
          entrySelections: this.entrySelections,
          activityParents: Object.fromEntries(this.activityParents),
          messageStart: this.selectedStart,
          interruptedScopes: this.interruptedScopes,
          boundaryOccurrences: this.boundaryOccurrences,
        },
        jobs: [...this.jobs.values()],
        cancelledExecutionIds: [...this.cancelled],
        unconsumedCompletionIds: [...this.completed.keys()],
        unconsumedSignalIds: this.unconsumedSignalIds,
        transitions: this.transitions,
        activeActivities,
        nextWakeAt,
        status,
        error: this.failure?.message ?? null,
      };
    } finally {
      if (this.engine.execution?.isRunning) await this.engine.stop();
      for (const timer of this.timers.executing)
        this.timers.clearTimeout(timer);
    }
  }
}
