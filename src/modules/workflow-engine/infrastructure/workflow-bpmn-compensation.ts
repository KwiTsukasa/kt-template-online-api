import { Activity, EndEvent, IntermediateThrowEvent } from 'bpmn-elements';
import {
  EndEventBehaviour,
  IntermediateThrowEventBehaviour,
} from 'bpmn-elements/events';
import { WorkflowBpmnFlowIndex } from './workflow-bpmn-flow-index';
import { workflowBpmnOuterParent } from './workflow-bpmn-scope';

/**
 * 让抛出补偿按当前作用域及指定活动派发，默认等待关联处理器完成，并把等待身份写入原生执行队列。
 * @param source - 引擎原有的补偿事件行为，捕获端仍由原生队列处理。
 * @param activity - 当前抛出补偿的事件活动。
 * @param definition - 包含活动引用及是否等待的标准事件定义。
 * @param context - 当前流程实例的活动与关联索引。
 */
export function configureWorkflowCompensationThrow(
  source: any,
  activity: any,
  definition: any,
  context: any,
): void {
  source.executeThrow = (message: any) => {
    const content = { ...message.content };
    const broker = activity.broker;
    const prefix = `_kt-compensation-${content.executionId}`;
    const pending = new Map<string, { id: string; executionId: string }>();
    for (const item of content.ktCompensationPending ?? [])
      pending.set(`${item.id}:${item.executionId}`, item);
    const subscriptions: Array<{ broker: any; tag: string }> = [];
    const activities = context.getActivities(activity.parent.id);
    let target = definition.behaviour.activityRef?.id;
    if (typeof definition.behaviour.activityRef === 'string')
      target = definition.behaviour.activityRef;
    const boundaries = activities.filter(
      (item: any) =>
        item.type === 'bpmn:BoundaryEvent' &&
        item.eventDefinitions?.some(
          (event: any) => event.type === 'bpmn:CompensateEventDefinition',
        ) &&
        (!target || item.attachedTo.id === target),
    );
    const remaining = new Set<string>(
      content.ktCompensationRemaining ??
        boundaries
          .filter(
            (item: any) => item.broker.getQueue('compensate-q')?.messageCount,
          )
          .map((item: any) => item.id),
    );
    const flows = new WorkflowBpmnFlowIndex(
      context.getSequenceFlows(activity.parent.id),
    );
    let initializing = true;
    let finished = false;
    const cleanup = () => {
      for (const item of subscriptions) item.broker.cancel(item.tag);
      subscriptions.length = 0;
    };
    const update = () => {
      if (initializing || finished) return;
      while (!pending.size && remaining.size) {
        const waiting = boundaries.filter((item: any) =>
          remaining.has(item.id),
        );
        const latest = (boundary: any) =>
          Math.max(
            0,
            ...(
              boundary.broker.getQueue('compensate-q')?.getState()?.messages ??
              []
            ).map((record: any) => record.content.ktCompensationOrder ?? 0),
          );
        const ready = waiting.filter(
          (item: any, index: number) =>
            !waiting.some((other: any, otherIndex: number) => {
              if (
                other === item ||
                !flows.reaches(item.attachedTo.id, other.attachedTo.id)
              )
                return false;
              if (!flows.reaches(other.attachedTo.id, item.attachedTo.id))
                return true;
              if (latest(other) === latest(item)) return otherIndex > index;
              return latest(other) > latest(item);
            }),
        );
        initializing = true;
        for (const boundary of ready) {
          const queue = boundary.broker.getQueue('compensate-q');
          if (!queue?.messageCount) {
            remaining.delete(boundary.id);
            continue;
          }
          for (const association of context.getOutboundAssociations(
            boundary.id,
          )) {
            const handler = context.getActivityById(association.targetId);
            if (handler.isRunning)
              pending.set(`${handler.id}:${handler.executionId}`, {
                id: handler.id,
                executionId: handler.executionId,
              });
          }
          const cyclic = waiting.some(
            (other: any) =>
              other !== boundary &&
              flows.reaches(boundary.attachedTo.id, other.attachedTo.id) &&
              flows.reaches(other.attachedTo.id, boundary.attachedTo.id),
          );
          if (cyclic && queue.messageCount > 1) {
            const records = [];
            while (queue.messageCount) records.push(queue.get({ noAck: true }));
            let selected = records[0];
            for (const record of records)
              if (
                (record.content.ktCompensationOrder ?? 0) >=
                (selected.content.ktCompensationOrder ?? 0)
              )
                selected = record;
            for (const record of records)
              if (record !== selected)
                queue.queueMessage(
                  record.fields,
                  record.content,
                  record.properties,
                );
            for (const association of context.getOutboundAssociations(
              boundary.id,
            ))
              association.take(selected);
          } else {
            remaining.delete(boundary.id);
            boundary.getApi().sendApiMessage('compensate');
          }
        }
        initializing = false;
      }
      if (pending.size) {
        if (
          definition.behaviour.waitForCompletion === false &&
          !content.ktCompensationForwarded
        ) {
          content.ktCompensationForwarded = true;
          content.ignoreOutbound = true;
          const parent = workflowBpmnOuterParent(content.parent);
          broker.publish('execution', 'execute.outbound.take', {
            ...content,
            executionId: content.parent.executionId,
            parent,
            isRootScope: true,
            isDefinitionScope: undefined,
            ignoreOutbound: false,
          });
        }
        broker.publish('execution', 'execute.compensating', {
          ...content,
          ktCompensationPending: [...pending.values()],
          ktCompensationRemaining: [...remaining],
        });
        return;
      }
      finished = true;
      cleanup();
      broker.publish('execution', 'execute.completed', {
        ...content,
        ktCompensationPending: [],
        ktCompensationRemaining: [],
      });
    };
    for (const executionId of [
      content.executionId,
      content.parent.executionId,
    ]) {
      const tag = `${prefix}-api-${executionId}`;
      broker.subscribeTmp(
        'api',
        `activity.*.${executionId}`,
        (_: string, incoming: any) => {
          if (!['stop', 'discard', 'cancel'].includes(incoming.properties.type))
            return;
          finished = true;
          cleanup();
          if (incoming.properties.type !== 'stop')
            broker.publish('execution', 'execute.discard', content);
        },
        { noAck: true, consumerTag: tag, priority: 400 },
      );
      subscriptions.push({ broker, tag });
    }
    for (const handler of activities.filter(
      (item: any) => item.behaviour.isForCompensation,
    )) {
      const tag = `${prefix}-${handler.id}`;
      handler.broker.subscribeTmp(
        'event',
        'activity.#',
        (routingKey: string, incoming: any) => {
          if (incoming.content.id !== handler.id) return;
          const key = `${handler.id}:${incoming.content.executionId}`;
          if (routingKey === 'activity.enter' && initializing)
            pending.set(key, {
              id: handler.id,
              executionId: incoming.content.executionId,
            });
          if (routingKey === 'activity.leave') {
            pending.delete(key);
            queueMicrotask(update);
          }
        },
        { noAck: true, consumerTag: tag, priority: 500 },
      );
      subscriptions.push({ broker: handler.broker, tag });
    }
    if (!Array.isArray(content.ktCompensationPending)) {
      const parent = workflowBpmnOuterParent(content.parent);
      broker.publish(
        'event',
        'activity.compensate',
        {
          ...content,
          executionId: content.parent.executionId,
          parent,
          state: 'throw',
        },
        { type: 'compensate', delegate: false },
      );
    }
    initializing = false;
    update();
  };
}
/**
 * 补偿节点允许非等待模式提前传播一次出口，透传回执不会重复注册事件定义；其他事件沿用原实现。
 * @param definition - 抛出或结束事件的固定标准定义。
 * @param context - 当前作用域的活动上下文。
 * @returns 保留补偿等待队列且能提前传播出口的活动。
 */
export function WorkflowCompensationThrowActivity(
  definition: any,
  context: any,
): any {
  let factory = IntermediateThrowEvent;
  let Behaviour = IntermediateThrowEventBehaviour;
  if (definition.type === 'bpmn:EndEvent') {
    factory = EndEvent;
    Behaviour = EndEventBehaviour;
  }
  if (
    !definition.behaviour.eventDefinitions?.some(
      (item: any) => item.type === 'bpmn:CompensateEventDefinition',
    )
  )
    return factory(definition, context);
  /**
   * 过滤已传播出口的内部回执，等待或恢复仍进入原事件定义执行器。
   * @param activity - 当前抛出补偿的活动实例。
   * @returns 包装透传入口的原生事件行为。
   */
  function CompensationThrowBehaviour(activity: any): any {
    const source = new Behaviour(activity);
    const execute = source.execute.bind(source);
    source.execute = (message: any) => {
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
