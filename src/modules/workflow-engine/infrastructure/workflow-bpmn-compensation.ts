import { BPMN_EXCHANGE, BPMN_ROUTING } from '../constants/bpmn-runtime';
import { randomUUID } from 'node:crypto';
import {
  Activity,
  EndEvent,
  IntermediateThrowEvent,
  type ActivityDefinition,
  type ContextInstance,
  type ElementBrokerMessage,
  type ElementMessageContent,
} from 'bpmn-elements';
import {
  EndEventBehaviour,
  IntermediateThrowEventBehaviour,
} from 'bpmn-elements/events';
import { BPMN_TYPE } from '../constants/bpmn';
import {
  COMPENSATION_BOUNDARY_QUEUE,
  COMPENSATION_PHASE,
  COMPENSATION_SCOPE_QUEUE,
  COMPENSATION_SUBSCRIPTION,
} from '../constants/compensation';
import {
  WorkflowCompensationPlan,
  type CompensationTarget,
} from './workflow-bpmn-compensation-plan';
import { isWorkflowCompensationReceipt } from './workflow-bpmn-compensation-receipt';
import { workflowBpmnOuterParent } from './workflow-bpmn-scope';

interface CompensationSource {
  executeThrow?(message: { content: ElementMessageContent }): void;
}
interface CompensationDefinition {
  behaviour: {
    activityRef?: string | { id: string };
    waitForCompletion?: boolean;
  };
}
type CompensationActivity = Pick<Activity, 'id' | 'parent' | 'broker'>;
type CompensationQueue = ReturnType<Activity['broker']['getQueue']>;
type CompensationIdentity = { id: string; executionId: string };
type CompensationContent = ElementMessageContent & {
  ktCompensationPending?: CompensationIdentity[];
  ktCompensationSnapshots?: Record<string, ElementBrokerMessage[]>;
  ktCompensationClosed?: string[];
  ktCompensationRemaining?: string[];
  ktCompensationForwarded?: boolean;
};
type NativeCompensationTarget = CompensationTarget<ElementBrokerMessage> & {
  activity: Activity;
  associations: ReturnType<ContextInstance['getOutboundAssociations']>;
};

/**
 * 为每次抛出建立独立补偿执行状态，入口不再持有收据、订阅和派发回调的嵌套闭包。
 * @param source - 引擎原有的补偿事件行为。
 * @param activity - 当前抛出补偿的事件活动。
 * @param definition - 指定目标及是否等待的标准事件定义。
 * @param context - 当前流程实例的活动和关联索引。
 */
export function configureWorkflowCompensationThrow(
  source: CompensationSource,
  activity: CompensationActivity,
  definition: CompensationDefinition,
  context: ContextInstance,
): void {
  source.executeThrow = ({ content }) =>
    new WorkflowCompensationExecution(
      activity,
      definition,
      context,
      content,
    ).start();
}

class WorkflowCompensationExecution {
  private phase: (typeof COMPENSATION_PHASE)[keyof typeof COMPENSATION_PHASE] =
    COMPENSATION_PHASE.initializing;
  private readonly content: CompensationContent;
  private readonly context: ContextInstance;
  private readonly activities: Activity[];
  private readonly prefix: string;
  private readonly pending = new Map<string, CompensationIdentity>();
  private readonly subscriptions: Array<{
    broker: Activity['broker'];
    tag: string;
  }> = [];
  private readonly targets = new Map<string, NativeCompensationTarget>();
  private readonly closedTargets: Set<string>;
  private readonly plan: WorkflowCompensationPlan<ElementBrokerMessage>;
  private advanceScheduled = false;

  constructor(
    private readonly activity: CompensationActivity,
    private readonly definition: CompensationDefinition,
    context: ContextInstance,
    incoming: ElementMessageContent,
  ) {
    this.content = {
      ...incoming,
      ktCompensationSnapshots: structuredClone(
        incoming.ktCompensationSnapshots ?? {},
      ),
    };
    this.prefix = `${COMPENSATION_SUBSCRIPTION.prefix}-${incoming.executionId}`;
    this.closedTargets = new Set(incoming.ktCompensationClosed ?? []);
    for (const item of incoming.ktCompensationPending ?? [])
      this.addPending(item.id, item.executionId);
    let scopeId = activity.parent.id;
    this.context = context;
    if (
      context.environment.variables.ktCompensationScope?.handlerId ===
        scopeId &&
      context.owner?.context
    ) {
      this.context = context.owner.context;
      scopeId = this.context.owner.id;
    }
    this.activities = this.context.getActivities(scopeId);
    let requested = definition.behaviour.activityRef;
    if (typeof requested === 'object') requested = requested.id;
    for (const candidate of this.activities) {
      const target = this.captureTarget(candidate, requested);
      if (target) this.targets.set(target.id, target);
    }
    this.plan = new WorkflowCompensationPlan(
      this.context.getSequenceFlows(scopeId),
      [...this.targets.values()],
      (record) => {
        const order = record.content.ktCompensationOrder;
        if (Number.isSafeInteger(order) && order >= 0) return order;
        return 0;
      },
    );
  }

  /**
   * 先安装本次抛出拥有的监听，再公开抛出事件并推进，初始化失败时统一释放监听。
   * @throws 订阅或初始化失败时释放本次监听后原样抛出。
   */
  start(): void {
    try {
      this.subscribeControls();
      this.subscribeHandlers();
      this.publishThrow();
      this.phase = COMPENSATION_PHASE.ready;
      this.advance();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /**
   * 只选择当前作用域及指定活动，收据在抛出开始时认领，之后新完成的活动留给下一次抛出。
   * @param candidate - 当前作用域的活动。
   * @param requested - 标准补偿引用的可选活动身份。
   * @returns 本次拥有的补偿目标；不符合范围时为空。
   */
  private captureTarget(
    candidate: Activity,
    requested?: string,
  ): NativeCompensationTarget | undefined {
    const boundary =
      candidate.type === BPMN_TYPE.BoundaryEvent &&
      candidate.eventDefinitions?.some(
        (event) => event.type === BPMN_TYPE.CompensateEventDefinition,
      );
    let ownerId = candidate.id;
    let queue = candidate.broker.getQueue(COMPENSATION_SCOPE_QUEUE);
    if (boundary) {
      ownerId = candidate.attachedTo.id;
      queue = candidate.broker.getQueue(COMPENSATION_BOUNDARY_QUEUE);
    }
    if ((!boundary && !queue) || (requested && ownerId !== requested))
      return undefined;
    const snapshots = this.content.ktCompensationSnapshots!;
    snapshots[candidate.id] ??= this.claimReceipts(
      candidate,
      queue,
      Boolean(boundary),
    );
    return {
      id: candidate.id,
      activityId: ownerId,
      sequential: !boundary,
      records: snapshots[candidate.id],
      activity: candidate,
      associations: this.context.getOutboundAssociations(candidate.id),
    };
  }

  /**
   * 一次消费目标当前队列，排除容器占位和失败收据，尚未完成的子流程快照原序留在队列。
   * @param candidate - 收据所属的活动。
   * @param queue - 原生补偿收据队列。
   * @param boundary - 是否来自补偿边界而非子流程快照。
   * @returns 本次抛出独占的已完成收据，不复制收据业务内容。
   */
  private claimReceipts(
    candidate: Activity,
    queue: CompensationQueue,
    boundary: boolean,
  ): ElementBrokerMessage[] {
    const records: ElementBrokerMessage[] = [];
    const count = queue?.messageCount ?? 0;
    for (let index = 0; index < count; index++) {
      const record = queue.get({ noAck: true });
      if (!record) break;
      if (
        boundary &&
        !isWorkflowCompensationReceipt(candidate.attachedTo, record)
      )
        continue;
      if (!boundary && !record.content.ready) {
        queue.queueMessage(record.fields, record.content, record.properties);
        continue;
      }
      records.push({
        fields: record.fields,
        content: record.content,
        properties: record.properties,
      });
    }
    return records;
  }

  /**
   * 只在没有待完成处理器时取得下一批，关闭或派发中的回调不能重入推进。
   */
  private advance(): void {
    if (
      this.phase !== COMPENSATION_PHASE.ready &&
      this.phase !== COMPENSATION_PHASE.waiting
    )
      return;
    while (!this.pending.size && this.plan.remainingTargets().size) {
      this.phase = COMPENSATION_PHASE.dispatching;
      for (const dispatch of this.plan.take()) {
        if (this.isClosed()) return;
        this.dispatch(this.targets.get(dispatch.target.id)!, dispatch.record);
      }
      if (this.isClosed()) return;
      this.phase = COMPENSATION_PHASE.ready;
    }
    this.content.ktCompensationClosed = [...this.closedTargets];
    if (!this.pending.size) {
      this.complete();
      return;
    }
    this.forwardWithoutWaiting();
    this.phase = COMPENSATION_PHASE.waiting;
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompensating,
      {
        ...this.content,
        ktCompensationPending: [...this.pending.values()],
        ktCompensationRemaining: [...this.plan.remainingTargets()],
      },
    );
  }

  /**
   * 由目标种类选择原生关联派发或子流程快照重入，两条路径都先登记本次等待身份。
   * @param target - 已认领收据的固定目标。
   * @param record - 当前需要补偿的完成收据。
   */
  private dispatch(
    target: NativeCompensationTarget,
    record: ElementBrokerMessage,
  ): void {
    if (target.sequential) {
      const executionId = `${target.id}_comp_${randomUUID()}`;
      this.addPending(target.id, executionId);
      if (target.activity.isRunning)
        queueMicrotask(() =>
          this.startScope(target.activity, record, executionId),
        );
      else this.startScope(target.activity, record, executionId);
      return;
    }
    if (!this.closedTargets.has(target.id)) {
      this.closedTargets.add(target.id);
      target.activity.getApi().sendApiMessage('compensate');
    }
    for (const association of target.associations) {
      if (this.isClosed()) return;
      const handler = this.context.getActivityById(association.targetId);
      if (handler.isRunning) this.addPending(handler.id, handler.executionId);
      association.take(record);
    }
  }

  /**
   * 在宿主离开栈后用完成快照重入子流程，启动错误关闭本次执行并向引擎报告，不能改写为等待。
   * @param activity - 需要重入的宿主子流程。
   * @param record - 已完成实例的私有快照。
   * @param executionId - 本次补偿预分配的精确身份。
   */
  private startScope(
    activity: Activity,
    record: ElementBrokerMessage,
    executionId: string,
  ): void {
    if (this.isClosed()) return;
    try {
      activity.run({
        id: activity.id,
        initExecutionId: executionId,
        ignoreOutbound: true,
        ktCompensationSnapshot: record.content,
      });
    } catch (error) {
      this.close();
      this.activity.broker.publish(
        BPMN_EXCHANGE.execution,
        BPMN_ROUTING.executeError,
        { ...this.content, error },
        { mandatory: true },
      );
    }
  }

  /**
   * 监听当前抛出及其活动层的停止命令，只有取消和丢弃继续传播原生丢弃结果。
   */
  private subscribeControls(): void {
    for (const executionId of [
      this.content.executionId,
      this.content.parent.executionId,
    ]) {
      const tag = `${this.prefix}-api-${executionId}`;
      this.activity.broker.subscribeTmp(
        BPMN_EXCHANGE.api,
        `activity.*.${executionId}`,
        (_routingKey: string, message: ElementBrokerMessage) =>
          this.onControl(message),
        {
          noAck: true,
          consumerTag: tag,
          priority: COMPENSATION_SUBSCRIPTION.controlPriority,
        },
      );
      this.subscriptions.push({ broker: this.activity.broker, tag });
    }
  }

  /**
   * 每个处理器只安装一份状态监听，派发时收集身份，离开时删除等待并安排一次后续推进。
   */
  private subscribeHandlers(): void {
    for (const handler of this.activities) {
      if (
        !handler.behaviour.isForCompensation &&
        !handler.broker.getQueue(COMPENSATION_SCOPE_QUEUE)
      )
        continue;
      const tag = `${this.prefix}-${handler.id}`;
      handler.broker.subscribeTmp(
        BPMN_EXCHANGE.event,
        BPMN_ROUTING.activityAll,
        (routingKey: string, message: ElementBrokerMessage) =>
          this.onHandler(handler.id, routingKey, message),
        {
          noAck: true,
          consumerTag: tag,
          priority: COMPENSATION_SUBSCRIPTION.handlerPriority,
        },
      );
      this.subscriptions.push({ broker: handler.broker, tag });
    }
  }

  /**
   * 统一处理外部停止请求，关闭阶段不会继续派发尚未执行的补偿。
   * @param message - 当前活动的原生控制消息。
   */
  private onControl(message: ElementBrokerMessage): void {
    if (!COMPENSATION_SUBSCRIPTION.stopCommands.has(message.properties.type))
      return;
    this.close();
    if (message.properties.type !== 'stop')
      this.activity.broker.publish(
        BPMN_EXCHANGE.execution,
        BPMN_ROUTING.executeDiscard,
        this.content,
      );
  }

  /**
   * 只接收当前处理器本身的进入和离开，子活动事件不能冒充该处理器的完成。
   * @param id - 已安装监听的处理器身份。
   * @param event - 原生事件路由。
   * @param message - 携带准确执行身份的事件消息。
   */
  private onHandler(
    id: string,
    event: string,
    message: ElementBrokerMessage,
  ): void {
    if (message.content.id !== id) return;
    if (
      event === BPMN_ROUTING.activityEnter &&
      (this.phase === COMPENSATION_PHASE.initializing ||
        this.phase === COMPENSATION_PHASE.dispatching)
    )
      this.addPending(id, message.content.executionId);
    if (event !== BPMN_ROUTING.activityLeave) return;
    this.pending.delete(`${id}:${message.content.executionId}`);
    this.scheduleAdvance();
  }

  /**
   * 将同一轮多个处理器离开合并成一次推进，避免下一批等待期间重复写出相同检查点。
   */
  private scheduleAdvance(): void {
    if (this.advanceScheduled || this.isClosed()) return;
    this.advanceScheduled = true;
    queueMicrotask(() => {
      this.advanceScheduled = false;
      this.advance();
    });
  }

  /**
   * 统一记录需要等待的处理器实例，多次事件不会重复增加同一身份。
   * @param id - 处理器或补偿宿主身份。
   * @param executionId - 本次处理器的精确执行身份。
   */
  private addPending(id: string, executionId: string): void {
    this.pending.set(`${id}:${executionId}`, { id, executionId });
  }

  /**
   * 首次抛出才发布补偿事件，恢复既有等待时不重复对外通知。
   */
  private publishThrow(): void {
    if (Array.isArray(this.content.ktCompensationPending)) return;
    this.activity.broker.publish(
      BPMN_EXCHANGE.event,
      BPMN_ROUTING.activityCompensate,
      {
        ...this.content,
        executionId: this.content.parent.executionId,
        parent: workflowBpmnOuterParent(this.content.parent),
        state: 'throw',
      },
      { type: 'compensate', delegate: false },
    );
  }

  /**
   * 非等待模式只向后继传播一次，补偿处理器继续保留自己的恢复身份。
   */
  private forwardWithoutWaiting(): void {
    if (
      this.definition.behaviour.waitForCompletion !== false ||
      this.content.ktCompensationForwarded
    )
      return;
    this.content.ktCompensationForwarded = true;
    this.content.ignoreOutbound = true;
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeOutboundTake,
      {
        ...this.content,
        executionId: this.content.parent.executionId,
        parent: workflowBpmnOuterParent(this.content.parent),
        isRootScope: true,
        isDefinitionScope: undefined,
        ignoreOutbound: false,
      },
    );
  }

  /**
   * 全部收据和处理器完成后关闭订阅并发布唯一完成结果。
   */
  private complete(): void {
    this.close();
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompleted,
      {
        ...this.content,
        ktCompensationPending: [],
        ktCompensationRemaining: [],
      },
    );
  }

  /**
   * 标记执行关闭并释放该次抛出拥有的全部订阅，可重复调用且不影响其他执行。
   */
  private close(): void {
    this.phase = COMPENSATION_PHASE.closed;
    for (const item of this.subscriptions) item.broker.cancel(item.tag);
    this.subscriptions.length = 0;
  }

  /**
   * 为排队的回调读取实时关闭状态，防止同步派发中出现的错误被后续阶段覆盖。
   * @returns 本次补偿已经完成、停止或失败时返回真。
   */
  private isClosed(): boolean {
    return this.phase === COMPENSATION_PHASE.closed;
  }
}

/**
 * 补偿节点允许非等待模式提前传播一次出口，透传回执不会重复注册事件定义；其他事件沿用原实现。
 * @param definition - 抛出或结束事件的固定标准定义。
 * @param context - 当前作用域的活动上下文。
 * @returns 保留补偿等待队列且能提前传播出口的活动。
 */
export function WorkflowCompensationThrowActivity(
  definition: ActivityDefinition,
  context: ContextInstance,
): Activity {
  let factory = IntermediateThrowEvent;
  let Behaviour = IntermediateThrowEventBehaviour;
  if (definition.type === BPMN_TYPE.EndEvent) {
    factory = EndEvent;
    Behaviour = EndEventBehaviour;
  }
  if (
    !definition.behaviour.eventDefinitions?.some(
      (item) => item.type === BPMN_TYPE.CompensateEventDefinition,
    )
  )
    return factory(definition, context);
  /**
   * 过滤已传播出口的内部回执，等待或恢复仍进入原事件定义执行器。
   * @param activity - 当前抛出补偿的活动实例。
   * @returns 包装透传入口的原生事件行为。
   */
  function CompensationThrowBehaviour(
    activity: Activity,
  ): IntermediateThrowEventBehaviour {
    const source = new Behaviour(activity);
    const execute = source.execute.bind(source);
    source.execute = (message) => {
      if (message.fields.routingKey === 'run.execute.passthrough') return;
      return execute(message);
    };
    return source;
  }
  return new Activity(
    CompensationThrowBehaviour,
    { ...definition, isThrowing: true },
    context,
  );
}
