import {
  BPMN_EXCHANGE,
  BPMN_ROUTING,
  BPMN_QUEUE,
} from '../constants/bpmn-runtime';
import { isWorkflowCompensationReceipt } from './workflow-bpmn-compensation-receipt';
import { BPMN_TYPE } from '@/modules/workflow-engine/constants/bpmn';
import {
  Activity,
  BoundaryEvent,
  CompensateEventDefinition,
} from 'bpmn-elements';
import { BoundaryEventBehaviour } from 'bpmn-elements/events';
import { WorkflowConcurrentTaskBehaviour } from './workflow-bpmn-task';
import { configureWorkflowCompensationThrow } from './workflow-bpmn-compensation';
import { nextCompensationOrder } from './workflow-bpmn-compensation-scope';

/**
 * 普通并发任务逐个补偿成功实例，显式循环完成后整体补偿一次；同时排除错误、撤销及旧队列中的容器记录。
 * @param activity - 当前捕获或抛出补偿事件的活动。
 * @param definition - 标准补偿事件定义。
 * @param context - 活动及补偿关联所在的流程上下文。
 * @returns 保留原生队列和补偿传播的事件行为。
 */
export function WorkflowCompensateEventDefinition(
  activity: any,
  definition: any,
  context: any,
): any {
  const source: any = new CompensateEventDefinition(
    activity,
    definition,
    context,
  );
  if (activity.type === BPMN_TYPE.StartEvent) {
    const executeCatch = source.executeCatch.bind(source);
    source.executeCatch = (message: any) => {
      if (
        activity.environment.variables.ktCompensationScope?.handlerId ===
        activity.parent.id
      )
        return activity.broker.publish(
          BPMN_EXCHANGE.execution,
          BPMN_ROUTING.executeCompleted,
          message.content,
        );
      return executeCatch(message);
    };
  }
  if (activity.isThrowing) {
    configureWorkflowCompensationThrow(source, activity, definition, context);
    return source;
  }
  const host = activity.attachedTo;
  for (const method of ['_onCollect', '_onCollected']) {
    const receive = source[method].bind(source);
    source[method] = (routingKey: string, message: any) => {
      if (!isWorkflowCompensationReceipt(host, message)) return;
      if (routingKey === BPMN_ROUTING.executeCompleted) {
        const content = message.content;
        if (method === '_onCollect') {
          message = {
            ...message,
            content: {
              ...content,
              ktCompensationOrder: nextCompensationOrder(
                context,
                activity.parent.id,
              ),
            },
          };
        }
      }
      return receive(routingKey, message);
    };
  }
  return source;
}

/**
 * 排除发给任务的定向办理信号，并按抛出身份去重重复传播，非中断边界再次监听仍只消费一次。
 * @param Definition - 引擎原有的消息、信号或升级事件行为。
 * @param occurrences - 随工作流检查点持久化的宿主实例消费记录。
 * @returns 保留原事件匹配与传播能力的事件构造器。
 */
export function repeatingBpmnEvent(
  Definition: any,
  occurrences: Record<string, string[]>,
) {
  /**
   * 为非中断边界保留独立消费身份，普通事件继续原行为。
   * @param activity - 当前事件所附着的活动实例。
   * @param definition - 当前固定事件定义。
   * @returns 只消费每个抛出身份一次的事件行为。
   */
  function RepeatingEvent(activity: any, definition: any) {
    const source = new Definition(activity, definition);
    if (activity.type !== BPMN_TYPE.BoundaryEvent) return source;
    const receive = source._onCatchMessage.bind(source);
    source._onCatchMessage = (routingKey: string, message: any) => {
      const content = message.content;
      if (
        source.type === BPMN_TYPE.SignalEventDefinition &&
        content?.message?.executionId
      )
        return;
      if (activity.behaviour.cancelActivity !== false)
        return receive(routingKey, message);
      if (content?.message?.id !== source.reference.id)
        return receive(routingKey, message);
      const origin = content.source ?? content;
      if (!origin.executionId) return receive(routingKey, message);
      const key = `${activity.id}:${activity.attachedTo.executionId}`;
      const identity = `${origin.id}:${origin.executionId}:${message.properties.type}`;
      const received = (occurrences[key] ??= []);
      if (received.includes(identity)) return;
      received.push(identity);
      return receive(routingKey, message);
    };
    return source;
  }
  return RepeatingEvent;
}

/**
 * 普通任务的每个令牌建立独立边界监听，循环和子流程保留引擎原有作用域。
 * @param definition - 边界事件及附着活动定义。
 * @param context - 当前流程的活动注册表。
 * @returns 能按宿主实例恢复监听和撤销的边界活动。
 */
export function WorkflowConcurrentBoundary(definition: any, context: any) {
  const host = context.getActivityById(definition.behaviour.attachedTo.id);
  if (
    !host.ktConcurrentTask ||
    definition.behaviour.eventDefinitions?.some(
      (event: any) => event.type === BPMN_TYPE.CompensateEventDefinition,
    )
  )
    return BoundaryEvent(definition, context);
  const activity: any = new Activity(
    WorkflowConcurrentBoundaryBehaviour,
    definition,
    context,
  );
  const inbound = activity._onInboundEvent.bind(activity);
  activity._onInboundEvent = (routingKey: string, message: any) => {
    if (
      !message.content.ktTaskInstance ||
      routingKey !== BPMN_ROUTING.activityInstanceEnter
    )
      return;
    return inbound(BPMN_ROUTING.activityEnter, {
      ...message,
      fields: { ...message.fields, routingKey: BPMN_ROUTING.activityEnter },
    });
  };
  return activity;
}

class WorkflowConcurrentBoundaryBehaviour extends WorkflowConcurrentTaskBehaviour {
  /**
   * 以独立消息队列恢复每个宿主的原生边界行为，旧快照保留原执行身份。
   * @param message - 当前监听实例的持久执行消息。
   * @returns 原生旧版行为或具有独立队列的边界监听器。
   */
  protected behaviour(message?: any): any {
    if (!message) return new BoundaryEventBehaviour(this.activity);
    return new BoundaryInstance(this.activity, message);
  }
}

class BoundaryInstance {
  private readonly listener: any;
  private restored = false;
  private forwarding = false;

  constructor(
    private readonly aggregate: any,
    private readonly message: any,
  ) {
    const hostContent = message.content.inbound[0];
    const host = aggregate.attachedTo;
    const hostBroker = new Proxy(host.broker, {
      get: (target, key) => {
        if (key === 'subscribeTmp' || key === 'subscribeOnce')
          return (
            exchange: string,
            pattern: string,
            callback: any,
            options: any,
          ) => {
            if (pattern === BPMN_ROUTING.activityLeave)
              pattern = BPMN_ROUTING.activityInstanceLeave;
            return target[key](
              exchange,
              pattern,
              (routingKey: string, incoming: any) => {
                if (incoming.content.executionId !== hostContent.executionId)
                  return;
                callback(routingKey, incoming);
              },
              options,
            );
          };
        const value = Reflect.get(target, key, target);
        if (typeof value === 'function') return value.bind(target);
        return value;
      },
    });
    const attachedTo = new Proxy(host, {
      get: (target, key) => {
        if (key === 'broker') return hostBroker;
        if (key === 'executionId') return hostContent.executionId;
        return Reflect.get(target, key, target);
      },
    });
    const context = Object.create(aggregate.context);
    context.getActivityById = (id: string) => {
      if (id === host.id) return attachedTo;
      return aggregate.context.getActivityById(id);
    };
    context.getInboundSequenceFlows = () => [];
    context.getOutboundSequenceFlows = () => [];
    context.getInboundAssociations = () => [];
    this.listener = BoundaryEvent(
      {
        id: aggregate.id,
        type: aggregate.type,
        name: aggregate.name,
        behaviour: aggregate.behaviour,
        parent: message.content.parent,
      },
      context,
    );
    this.listener.addInboundListeners = () => 0;
    this.listener.removeInboundListeners = () => undefined;
  }

  /**
   * 运行或恢复原生监听器，将每次捕获的出口和终止分别通知活动容器。
   * @param message - 容器提供的当前监听身份。
   */
  execute(message: any): void {
    const listener = this.listener;
    const broker = this.aggregate.broker;
    listener.broker.subscribeTmp(
      BPMN_EXCHANGE.event,
      '#',
      (routingKey: string, incoming: any) => {
        let content = incoming.content;
        if (content.executionId === this.aggregate.executionId)
          content = {
            ...content,
            executionId: this.message.content.executionId,
          };
        broker.publish(BPMN_EXCHANGE.event, routingKey, content, {
          ...incoming.properties,
          mandatory: false,
        });
        if (routingKey === BPMN_ROUTING.activityEnd)
          broker.publish(
            BPMN_EXCHANGE.execution,
            BPMN_ROUTING.executeOutboundTake,
            {
              ...message.content,
              output: content.output,
              ignoreOutbound: false,
              outbound: undefined,
            },
          );
        if (
          routingKey === BPMN_ROUTING.activityLeave &&
          !listener.isRunning &&
          !listener.broker.getQueue(BPMN_QUEUE.inbound).messageCount
        ) {
          broker.publish(
            BPMN_EXCHANGE.execution,
            BPMN_ROUTING.executeCompleted,
            {
              ...message.content,
              ktTaskDiscarded: true,
            },
          );
          broker.cancel(`_kt-boundary-api-${message.content.executionId}`);
        }
      },
      { noAck: true, consumerTag: '_kt-instance-events' },
    );
    broker.subscribeTmp(
      BPMN_EXCHANGE.api,
      '#',
      (routingKey: string, incoming: any) => {
        if (this.forwarding) return;
        this.forwarding = true;
        try {
          listener.broker.publish(
            BPMN_EXCHANGE.api,
            routingKey,
            incoming.content,
            incoming.properties,
          );
        } finally {
          this.forwarding = false;
        }
      },
      {
        noAck: true,
        consumerTag: `_kt-boundary-api-${message.content.executionId}`,
      },
    );
    listener.activate();
    if (this.restored) listener.resume();
    else
      listener.run({
        ...message.content,
        initExecutionId: message.content.executionId,
        isRootScope: true,
        ignoreOutbound: true,
      });
  }

  /**
   * 保存原生边界队列与计时信息，重启不重新创建监听期限。
   * @returns 可直接交给原生活动恢复的持久状态。
   */
  getState(): any {
    return this.listener.getState();
  }

  /**
   * 恢复已有边界实例和重复监听队列，保持对外等待事件身份。
   * @param state - 上次检查点中的原生活动状态。
   */
  recover(state: any): void {
    this.listener.recover(state);
    this.restored = true;
  }

  /**
   * 按监听器根身份或事件定义身份匹配操作，防止信号发给其他宿主。
   * @param message - 需要信号、取消或停止的准确执行消息。
   * @returns 此监听器的原生接口，其他实例返回空值。
   */
  getApi(message: any): any {
    const executionId = message.content.executionId;
    if (executionId === this.message.content.executionId) {
      const api = this.listener.getApi();
      if (api.content.executionId !== this.aggregate.executionId) return api;
      return {
        ...api,
        content: this.message.content,
        getExecuting: () => api.getExecuting(),
        getPostponed: () => api.getExecuting(),
        discard: () => api.discard(),
        stop: () => api.stop(),
      };
    }
    if (
      executionId === this.listener.executionId ||
      message.content.parent?.executionId === this.listener.executionId
    )
      return this.listener.getApi(message);
  }
}
