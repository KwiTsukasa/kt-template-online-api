/**
 * 对同一抛出事件在父流程和定义间的重复传播去重，使非中断边界可以同步再次监听。
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
    if (activity.type !== 'bpmn:BoundaryEvent' || activity.behaviour.cancelActivity !== false) return source;
    const receive = source._onCatchMessage.bind(source);
    source._onCatchMessage = (routingKey: string, message: any) => {
      const content = message.content;
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
