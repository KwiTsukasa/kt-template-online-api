import { Activity, BoundaryEvent } from 'bpmn-elements';
import { BoundaryEventBehaviour } from 'bpmn-elements/events';
import { WorkflowConcurrentTaskBehaviour } from './workflow-bpmn-task';

/**
 * 排除发给任务的定向办理信号，并按抛出身份去重重复传播，非中断边界再次监听仍只消费一次。
 * @param Definition - 引擎原有的消息、信号或升级事件行为。
 * @param occurrences - 随工作流检查点持久化的宿主实例消费记录。
 * @returns 保留原事件匹配与传播能力的事件构造器。
 */
export function repeatingBpmnEvent(Definition: any, occurrences: Record<string, string[]>) {
  /**
   * 为非中断边界保留独立消费身份，普通事件继续原行为。
   * @param activity - 当前事件所附着的活动实例。
   * @param definition - 当前固定事件定义。
   * @returns 只消费每个抛出身份一次的事件行为。
   */
  function RepeatingEvent(activity: any, definition: any) {
    const source = new Definition(activity, definition);
    if (activity.type !== 'bpmn:BoundaryEvent') return source;
    const receive = source._onCatchMessage.bind(source);
    source._onCatchMessage = (routingKey: string, message: any) => {
      const content = message.content;
      if (source.type === 'bpmn:SignalEventDefinition' && content?.message?.executionId) return;
      if (activity.behaviour.cancelActivity !== false) return receive(routingKey, message);
      if (content?.message?.id !== source.reference.id) return receive(routingKey, message);
      const origin = content.source ?? content;
      if (!origin.executionId) return receive(routingKey, message);
      const key = `${activity.id}:${activity.attachedTo.executionId}`;
      const identity = `${origin.id}:${origin.executionId}:${message.properties.type}`;
      const received = occurrences[key] ??= [];
      if (received.includes(identity)) return;
      received.push(identity);
      return receive(routingKey, message);
    };
    return source;
  }
  return RepeatingEvent;
}

/**
 * 将旧检查点中共享的普通任务边界展开为逐实例监听，保留第一份等待身份与原计时期限。
 * @param state - 已持久化的完整引擎状态，转换不修改调用者持有的对象。
 * @param elements - 当前固定版本的标准元素索引，用于确认边界与宿主关系。
 * @returns 补齐独立监听状态的引擎检查点；更早的单任务与补偿快照沿用原恢复方式。
 */
export function migrateBpmnBoundaryState(state: any, elements: Record<string, any>): any {
  const migrated = structuredClone(state);
  const pending = [migrated];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value.children)) {
      for (const boundary of value.children) {
        if (boundary.type !== 'bpmn:BoundaryEvent' || boundary.execution?.taskInstances || boundary.execution?.completed || !boundary.status) continue;
        const element = elements[boundary.id];
        if (element?.eventDefinitions?.some((event: any) => event.$type === 'bpmn:CompensateEventDefinition')) continue;
        const host = value.children.find((child: any) => child.id === element?.attachedToRef?.id);
        if (!host?.execution?.taskInstances) continue;
        const hosts = host.broker?.queues?.find((queue: any) => queue.name === 'execute-q')?.messages?.filter((message: any) => message.content.ktTaskInstance && !message.content.isRootScope).map((message: any) => message.content) ?? [];
        const queue = boundary.broker?.queues?.find((item: any) => item.name === 'execute-q');
        const rootMessage = queue?.messages?.find((message: any) => message.content.isRootScope);
        if (!hosts.length || !rootMessage) continue;
        const root = { ...rootMessage.content, preventComplete: true, ignoreOutbound: true };
        const parent = { id: root.id, type: root.type, executionId: root.executionId, path: [root.parent, ...(root.parent?.path ?? [])] };
        const listeners = hosts.map((content: any) => ({ ...root, executionId: `${root.executionId}_instance_${content.executionId}`, isRootScope: false, ignoreOutbound: false, ktTaskInstance: true, inbound: [content], parent }));
        const original = structuredClone(boundary);
        for (const originalQueue of original.broker.queues) {
          if (originalQueue.name === 'inbound-q') originalQueue.messages = [];
          for (const message of originalQueue.messages ?? []) {
            if (message.content.id !== root.id) continue;
            message.content.inbound = [hosts[0]];
            if (message.content.executionId === root.executionId) message.content.parent = parent;
            else if (message.content.parent?.executionId === root.executionId) message.content.parent.path = [parent, ...parent.path];
          }
        }
        boundary.execution = { completed: false, taskInstances: { root, arrivals: [], instances: { [listeners[0].executionId]: original } } };
        for (const outerQueue of boundary.broker.queues) {
          if (outerQueue.name === 'inbound-q') outerQueue.messages = [];
          if (outerQueue.name === 'run-q') for (const message of outerQueue.messages ?? []) message.content.ignoreOutbound = true;
        }
        queue.messages = [{ ...rootMessage, fields: { ...rootMessage.fields, routingKey: 'execute.concurrent' }, content: root }, ...listeners.map((content: any) => ({ fields: { routingKey: 'execute.start', exchange: 'execution' }, content, properties: {} }))];
      }
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return migrated;
}

/**
 * 普通任务的每个令牌建立独立边界监听，循环和子流程保留引擎原有作用域。
 * @param definition - 边界事件及附着活动定义。
 * @param context - 当前流程的活动注册表。
 * @returns 能按宿主实例恢复监听和撤销的边界活动。
 */
export function WorkflowConcurrentBoundary(definition: any, context: any) {
  const host = context.getActivityById(definition.behaviour.attachedTo.id);
  if (!host.ktConcurrentTask || definition.behaviour.eventDefinitions?.some((event: any) => event.type === 'bpmn:CompensateEventDefinition')) return BoundaryEvent(definition, context);
  const activity: any = new Activity(WorkflowConcurrentBoundaryBehaviour, definition, context);
  const inbound = activity._onInboundEvent.bind(activity);
  activity._onInboundEvent = (routingKey: string, message: any) => {
    if (!message.content.ktTaskInstance || routingKey !== 'activity.instance.enter') return;
    return inbound('activity.enter', { ...message, fields: { ...message.fields, routingKey: 'activity.enter' } });
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

  constructor(private readonly aggregate: any, private readonly message: any) {
    const hostContent = message.content.inbound[0];
    const host = aggregate.attachedTo;
    const hostBroker = new Proxy(host.broker, { get: (target, key) => {
      if (key === 'subscribeTmp' || key === 'subscribeOnce') return (exchange: string, pattern: string, callback: any, options: any) => {
        if (pattern === 'activity.leave') pattern = 'activity.instance.leave';
        return target[key](exchange, pattern, (routingKey: string, incoming: any) => {
          if (incoming.content.executionId !== hostContent.executionId) return;
          callback(routingKey, incoming);
        }, options);
      };
      const value = Reflect.get(target, key, target);
      if (typeof value === 'function') return value.bind(target);
      return value;
    } });
    const attachedTo = new Proxy(host, { get: (target, key) => {
      if (key === 'broker') return hostBroker;
      if (key === 'executionId') return hostContent.executionId;
      return Reflect.get(target, key, target);
    } });
    const context = Object.create(aggregate.context);
    context.getActivityById = (id: string) => {
      if (id === host.id) return attachedTo;
      return aggregate.context.getActivityById(id);
    };
    context.getInboundSequenceFlows = () => [];
    context.getOutboundSequenceFlows = () => [];
    context.getInboundAssociations = () => [];
    this.listener = BoundaryEvent({ id: aggregate.id, type: aggregate.type, name: aggregate.name, behaviour: aggregate.behaviour, parent: message.content.parent }, context);
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
    listener.broker.subscribeTmp('event', '#', (routingKey: string, incoming: any) => {
      let content = incoming.content;
      if (content.executionId === this.aggregate.executionId) content = { ...content, executionId: this.message.content.executionId };
      broker.publish('event', routingKey, content, { ...incoming.properties, mandatory: false });
      if (routingKey === 'activity.end') broker.publish('execution', 'execute.outbound.take', { ...message.content, output: content.output, ignoreOutbound: false, outbound: undefined });
      if (routingKey === 'activity.leave' && !listener.isRunning && !listener.broker.getQueue('inbound-q').messageCount) {
        broker.publish('execution', 'execute.completed', { ...message.content, ktTaskDiscarded: true });
        broker.cancel(`_kt-boundary-api-${message.content.executionId}`);
      }
    }, { noAck: true, consumerTag: '_kt-instance-events' });
    broker.subscribeTmp('api', '#', (routingKey: string, incoming: any) => {
      if (this.forwarding) return;
      this.forwarding = true;
      try { listener.broker.publish('api', routingKey, incoming.content, incoming.properties); }
      finally { this.forwarding = false; }
    }, { noAck: true, consumerTag: `_kt-boundary-api-${message.content.executionId}` });
    listener.activate();
    if (this.restored) listener.resume();
    else listener.run({ ...message.content, initExecutionId: message.content.executionId, isRootScope: true, ignoreOutbound: true });
  }

  /**
   * 保存原生边界队列与计时信息，重启不重新创建监听期限。
   * @returns 可直接交给原生活动恢复的持久状态。
   */
  getState(): any { return this.listener.getState(); }

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
      return { ...api, content: this.message.content, getExecuting: () => api.getExecuting(), getPostponed: () => api.getExecuting(), discard: () => api.discard(), stop: () => api.stop() };
    }
    if (executionId === this.listener.executionId || message.content.parent?.executionId === this.listener.executionId) return this.listener.getApi(message);
  }
}
