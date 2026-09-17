import { BPMN_EXCHANGE, BPMN_ROUTING } from '../constants/bpmn-runtime';
import { BPMN_TYPE } from '@/modules/workflow-engine/constants/bpmn';
import { SubProcess, SubProcessBehaviour } from 'bpmn-elements/tasks';
import type {
  Activity,
  ActivityDefinition,
  ActivityState,
  ContextInstance,
  ElementBrokerMessage,
  ElementMessageContent,
  IActivityBehaviour,
  ProcessExecution,
} from 'bpmn-elements';
import type { ConsumeMessage, Queue } from 'smqp';

import {
  COMPENSATION_SCOPE_QUEUE,
  COMPENSATION_BOUNDARY_QUEUE,
} from '../constants/compensation';
const processElements: unique symbol = Symbol.for('elements');
const messageHandlers: unique symbol = Symbol.for('messageHandlers');
const completionOrders = new WeakMap<ContextInstance, Map<string, number>>();
const pendingScopeSnapshots = new WeakMap<
  Queue,
  Map<string, CompensationScopeSnapshot[]>
>();

interface CompensationScopeSnapshot {
  handlerId: string;
  variables: Record<string, unknown>;
  executionId: string;
  rootExecutionId: string;
  ready: boolean;
  ktCompensationOrder: number;
  children: ActivityState[];
}

/**
 * 在恢复后的原生队列首次使用时索引未就绪快照，历史已完成收据不参与后续逐次扫描。
 * @param queue - 本轮引擎拥有的原生持久快照队列。
 * @returns 按根活动实例分组的未就绪快照，内容仍属于原生队列。
 */
function pendingSnapshots(
  queue: Queue,
): Map<string, CompensationScopeSnapshot[]> {
  let pending = pendingScopeSnapshots.get(queue);
  if (pending) return pending;
  pending = new Map();
  for (const message of queue.messages) {
    const snapshot = message.content as CompensationScopeSnapshot;
    if (snapshot.ready) continue;
    const group = pending.get(snapshot.rootExecutionId) ?? [];
    group.push(snapshot);
    pending.set(snapshot.rootExecutionId, group);
  }
  pendingScopeSnapshots.set(queue, pending);
  return pending;
}

/**
 * 将成功子实例的完成快照入队并登记根归属，原生队列保留同一内容引用以便原子标记就绪。
 * @param queue - 宿主的原生持久快照队列。
 * @param snapshot - 本次成功子实例的独立数据快照。
 */
export function appendCompensationSnapshot(
  queue: Queue,
  snapshot: CompensationScopeSnapshot,
): void {
  const pending = pendingSnapshots(queue);
  const group = pending.get(snapshot.rootExecutionId) ?? [];
  queue.queueMessage({}, snapshot);
  group.push(snapshot);
  pending.set(snapshot.rootExecutionId, group);
}

/**
 * 仅在根活动成功后启用其子实例收据，其他根实例和历史就绪收据不再重复出入队。
 * @param queue - 当前宿主的原生快照队列。
 * @param executionId - 已确认完成的根活动身份。
 */
export function readyCompensationSnapshots(
  queue: Queue,
  executionId: string,
): void {
  const pending = pendingSnapshots(queue);
  for (const snapshot of pending.get(executionId) ?? []) snapshot.ready = true;
  pending.delete(executionId);
}

interface ScopeExecution extends ProcessExecution {
  [processElements]: { startActivities: Set<Activity> };
  [messageHandlers]: {
    onChildMessage: (routingKey: string, message: ConsumeMessage) => void;
  };
  _start(): void;
}

interface NativeScopeBehaviour extends SubProcessBehaviour {
  _upsertExecution(message: ElementBrokerMessage): ScopeExecution;
  _getExecutionById(executionId: string): ScopeExecution;
  _completeExecution(routingKey: string, content: ElementMessageContent): void;
}

const NativeSubProcess = SubProcessBehaviour as unknown as new (
  activity: Activity,
  context: ContextInstance,
) => NativeScopeBehaviour;

/**
 * 为含补偿事件子流程的宿主保存完成时的逐实例数据，快照队列随原生活动状态持久化。
 * @param definition - 普通子流程的固定活动定义。
 * @param context - 此宿主所属的原生流程上下文。
 * @param Behaviour - 已组合快照能力的可选事务行为，省略时按普通子流程选择。
 * @returns 带完成快照收集能力的子流程；没有补偿处理器时仍使用原生行为。
 */
export function WorkflowCompensatableSubProcess(
  definition: ActivityDefinition,
  context: ContextInstance,
  Behaviour?: IActivityBehaviour,
): Activity {
  const hasHandler = Boolean(compensationHandlerId(context, definition.id));
  let behaviour = Behaviour;
  if (!behaviour) {
    behaviour = SubProcessBehaviour;
    if (hasHandler) behaviour = CompensationScopeBehaviour;
  }
  const activity = SubProcess(definition, context, behaviour);
  if (hasHandler) {
    const queue = activity.broker.assertQueue(COMPENSATION_SCOPE_QUEUE, {
      durable: true,
      autoDelete: false,
    });
    activity.broker.subscribeTmp(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompleted,
      (_routingKey, message) => {
        const content = message.content;
        if (!content.isRootScope || content.ktCompensationSnapshot) return;
        readyCompensationSnapshots(queue, content.executionId);
      },
      { noAck: true, consumerTag: '_kt-compensation-ready', priority: 500 },
    );
  }
  return activity;
}

/**
 * 找到当前宿主内声明补偿开始事件的处理器，不将普通消息或错误子流程当作补偿。
 * @param context - 宿主实际执行使用的上下文。
 * @param hostId - 保存快照和拥有处理器的子流程标识。
 * @returns 补偿事件子流程的固定标识；不存在时返回空值。
 */
function compensationHandlerId(
  context: ContextInstance,
  hostId: string,
): string | undefined {
  const definitions = context.definitionContext;
  return definitions
    .getActivities(hostId)
    .find(
      (activity) =>
        activity.behaviour?.triggeredByEvent &&
        definitions
          .getActivities(activity.id)
          .some(
            (start) =>
              start.type === BPMN_TYPE.StartEvent &&
              start.behaviour?.eventDefinitions?.some(
                (event) => event.type === BPMN_TYPE.CompensateEventDefinition,
              ),
          ),
    )?.id;
}
/**
 * 每次恢复只扫描一次已有收据，之后在同一上下文中递增完成序号，边界和子流程共用计数。
 * @param context - 当前补偿目标所属的上下文。
 * @param scopeId - 只在该父作用域内比较，避免跨实例排序。
 * @returns 下一份成功完成快照应使用的顺序号。
 */
export function nextCompensationOrder(
  context: ContextInstance,
  scopeId: string,
): number {
  let scopes = completionOrders.get(context);
  if (!scopes) {
    scopes = new Map();
    completionOrders.set(context, scopes);
  }
  let order = scopes.get(scopeId);
  if (order === undefined) order = restoredCompensationOrder(context, scopeId);
  order++;
  scopes.set(scopeId, order);
  return order;
}

/**
 * 重建指定上下文的初始完成序号，只处理该作用域现存收据，空队列以零起算。
 * @param context - 已经恢复原生队列的流程上下文。
 * @param scopeId - 当前活动所属的父作用域。
 * @returns 已存在收据的最大完成序号。
 */
function restoredCompensationOrder(
  context: ContextInstance,
  scopeId: string,
): number {
  let order = 0;
  for (const activity of context.getActivities(scopeId)) {
    for (const name of [
      COMPENSATION_BOUNDARY_QUEUE,
      COMPENSATION_SCOPE_QUEUE,
    ]) {
      for (const record of activity.broker.getQueue(name)?.getState()
        ?.messages ?? []) {
        order = Math.max(order, record.content.ktCompensationOrder ?? 0);
      }
    }
  }
  return order;
}

export class CompensationScopeBehaviour extends NativeSubProcess {
  private readonly retainedChildren = new Map<string, ActivityState[]>();
  private readonly configured = new WeakSet<ScopeExecution>();
  /**
   * 补偿重入使用已完成实例的数据，只启动对应处理器，正常执行沿用原生入口与循环。
   * @param message - 含原生执行身份及可选补偿快照的消息。
   * @returns 已绑定本次快照的执行作用域。
   */
  _upsertExecution(message: ElementBrokerMessage): ScopeExecution {
    const execution = super._upsertExecution(message);
    if (this.configured.has(execution)) return execution;
    this.configured.add(execution);
    const snapshot = message.content.ktCompensationSnapshot as
      | CompensationScopeSnapshot
      | undefined;
    if (!snapshot) {
      const handlers = execution[messageHandlers];
      const receive = handlers.onChildMessage;
      handlers.onChildMessage = (routingKey, incoming) => {
        if (routingKey === BPMN_ROUTING.executionDiscardDetached)
          this.retainedChildren.set(
            execution.executionId,
            structuredClone(execution.getState().children),
          );
        return receive(routingKey, incoming);
      };
      return execution;
    }
    if (!message.fields.redelivered) {
      execution.environment.assignVariables({
        ...structuredClone(snapshot.variables),
        ktCompensationScope: {
          handlerId: snapshot.handlerId,
          executionId: snapshot.executionId,
        },
      });
      for (const child of snapshot.children ?? [])
        execution.getActivityById(child.id)?.recover(child);
    }
    const start = execution._start.bind(execution);
    execution._start = () => {
      const handler = execution.getActivityById(snapshot.handlerId);
      for (const activity of execution.getActivities())
        if (
          activity.type === BPMN_TYPE.BoundaryEvent &&
          activity.status &&
          activity.eventDefinitions?.some(
            (event) => event.type === BPMN_TYPE.CompensateEventDefinition,
          )
        )
          activity.resume();
      execution[processElements].startActivities.clear();
      execution[processElements].startActivities.add(handler);
      start();
    };
    return execution;
  }

  /**
   * 补偿运行本身不再次展开宿主的标准循环或多实例配置。
   * @param message - 原生宿主执行消息，快照只在补偿重入时存在。
   */
  execute(message: ElementBrokerMessage): void {
    if (message.content.ktCompensationSnapshot)
      this.loopCharacteristics = undefined;
    super.execute(message);
  }

  /**
   * 只收集成功的正向实例，在原生删除循环执行前保存数据副本，错误和补偿执行均不重新入队。
   * @param routingKey - 当前实例的完成、错误或撤销通道。
   * @param content - 当前实例身份及结果。
   */
  _completeExecution(routingKey: string, content: ElementMessageContent): void {
    if (
      routingKey === BPMN_ROUTING.executeCompleted &&
      !content.ktCompensationSnapshot
    ) {
      const execution = this._getExecutionById(content.executionId);
      const handlerId = compensationHandlerId(
        execution.context,
        this.activity.id,
      );
      if (handlerId) {
        const queue = this.broker.assertQueue(COMPENSATION_SCOPE_QUEUE, {
          durable: true,
          autoDelete: false,
        });
        appendCompensationSnapshot(queue, {
          handlerId,
          executionId: content.executionId,
          rootExecutionId: this.executionId,
          ready: false,
          variables: structuredClone(execution.environment.variables),
          ktCompensationOrder: nextCompensationOrder(
            this.context,
            this.activity.parent.id,
          ),
          children:
            this.retainedChildren.get(content.executionId) ??
            structuredClone(execution.getState().children),
        } satisfies CompensationScopeSnapshot);
      }
    }
    this.retainedChildren.delete(content.executionId);
    super._completeExecution(routingKey, content);
  }
}
