import {
  BPMN_EXCHANGE,
  BPMN_ROUTING,
  BPMN_QUEUE,
} from '../constants/bpmn-runtime';
import { BPMN_TYPE } from '@/modules/workflow-engine/constants/bpmn';
import { randomUUID } from 'node:crypto';
import { Activity } from 'bpmn-elements';
import { ServiceTaskBehaviour, UserTaskBehaviour } from 'bpmn-elements/tasks';
import { workflowBpmnChildParent } from './workflow-bpmn-scope';

/**
 * 为普通业务活动的每个入口令牌创建独立实例，显式循环仍交由标准循环行为处理。
 * @param definition - 人工或工作流受控服务活动的标准定义。
 * @param context - 活动所属流程实例上下文。
 * @returns 支持重叠令牌且沿用引擎持久队列的活动。
 */
export function WorkflowConcurrentTask(definition: any, context: any) {
  let Behaviour: any = ServiceTaskBehaviour;
  if (definition.type === BPMN_TYPE.UserTask) Behaviour = UserTaskBehaviour;
  if (definition.behaviour?.loopCharacteristics)
    return new Activity(Behaviour, definition, context);
  const activity = new Activity(
    WorkflowConcurrentTaskBehaviour,
    definition,
    context,
  );
  (activity as any).ktConcurrentTask = true;
  return activity;
}

export class WorkflowConcurrentTaskBehaviour {
  protected root: any;
  private arrivals: any[] = [];
  protected instances = new Map<string, any>();
  private restored: Record<string, any> = {};
  private running = false;
  private scheduled = false;
  private legacy: any;

  constructor(readonly activity: any) {}

  /**
   * 首次进入建立令牌容器，恢复仅重连已有实例；旧快照按原活动身份继续办理。
   * @param message - 引擎持久队列提供的根作用域或具体活动实例。
   */
  execute(message: any): void {
    if (message.fields.routingKey === 'run.execute.passthrough') return;
    if (this.legacy) {
      this.legacy.execute(message);
      return;
    }
    if (!message.content.isRootScope) {
      const source = this.behaviour(message);
      this.instances.set(message.content.executionId, source);
      if (this.restored[message.content.executionId])
        source.recover?.(this.restored[message.content.executionId]);
      source.execute(message);
      return;
    }
    if (this.running) return;
    this.running = true;
    this.root = {
      ...message.content,
      preventComplete: true,
      ignoreOutbound: true,
    };
    const broker = this.activity.broker;
    broker.subscribeTmp(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompleted,
      (_: string, completed: any) => {
        const content = completed.content;
        if (content.isRootScope) {
          this.stop();
          return;
        }
        if (completed.fields.redelivered) return;
        this.instances.delete(content.executionId);
        broker.cancel(`_kt-task-instance-${content.executionId}`);
        if (!content.ktTaskDiscarded) {
          broker.publish(
            BPMN_EXCHANGE.execution,
            BPMN_ROUTING.executeOutboundTake,
            {
              ...content,
              ignoreOutbound: false,
              outbound: undefined,
            },
          );
          broker.publish(BPMN_EXCHANGE.event, BPMN_ROUTING.activityEnd, {
            ...content,
            state: 'end',
          });
        }
        broker.publish(
          BPMN_EXCHANGE.event,
          BPMN_ROUTING.activityInstanceLeave,
          {
            ...content,
            state: 'leave',
          },
        );
        this.schedule();
      },
      { noAck: true, consumerTag: '_kt-task-completed', priority: 500 },
    );
    broker.subscribeTmp(
      BPMN_EXCHANGE.api,
      `activity.*.${this.root.executionId}`,
      (_: string, incoming: any) => {
        if (['stop', 'discard', 'cancel'].includes(incoming.properties.type))
          this.stop();
      },
      { noAck: true, consumerTag: '_kt-task-api', priority: 300 },
    );
    broker.getQueue(BPMN_QUEUE.inbound).consume(
      (_: string, incoming: any) => {
        this.arrivals.push(structuredClone(incoming.content));
        incoming.ack();
        this.schedule();
      },
      { consumerTag: '_kt-task-inbound', exclusive: true, prefetch: 1 },
    );
    if (!message.fields.redelivered) {
      broker.publish(
        BPMN_EXCHANGE.execution,
        BPMN_ROUTING.executeConcurrent,
        this.root,
      );
      this.spawn(message.content.inbound ?? []);
    }
    this.schedule();
  }

  /**
   * 保存入口、根身份及独立监听器队列，普通任务实例继续由引擎执行队列保存。
   * @returns 可恢复的活动状态；旧实例继续使用原行为状态。
   */
  getState() {
    if (this.legacy) return this.legacy.getState?.() ?? {};
    return {
      taskInstances: {
        root: structuredClone(this.root),
        arrivals: structuredClone(this.arrivals),
        instances: Object.fromEntries(
          [...this.instances]
            .filter(([, source]) => source.getState)
            .map(([id, source]) => [id, source.getState()]),
        ),
      },
    };
  }

  /**
   * 区分新版多令牌快照与既有单实例快照，避免升级改变待办和脚本身份。
   * @param state - 当前活动的持久恢复状态。
   */
  recover(state: any): void {
    if (!state.taskInstances) {
      this.legacy = this.behaviour();
      this.legacy.recover?.(state);
      return;
    }
    this.root = state.taskInstances.root;
    this.arrivals = state.taskInstances.arrivals ?? [];
    this.restored = state.taskInstances.instances ?? {};
  }

  /**
   * 将等待事件的操作发送给对应独立监听器，普通任务仍使用容器的实例接口。
   * @param message - 带有准确执行身份的接口消息。
   * @returns 已匹配的监听器接口，未匹配时由引擎提供默认接口。
   */
  getApi(message: any): any {
    if (message.content.executionId === this.root?.executionId) return;
    for (const source of this.instances.values()) {
      const api = source.getApi?.(message);
      if (api) return api;
    }
  }

  /**
   * 实例报错先交给其边界处理；局部撤销不走其他实例的出口，未捕获错误仍使流程失败。
   * @param message - 当前独立实例的执行消息；旧快照恢复时为空。
   * @returns 当前任务类别的原生行为实例。
   */
  protected behaviour(message?: any): any {
    let activity = this.activity;
    if (message) {
      const broker = this.activity.broker;
      const instanceBroker = new Proxy(broker, {
        get: (target, key) => {
          if (key === 'publish')
            return (
              exchange: string,
              routingKey: string,
              content: any,
              properties: any,
            ) => {
              if (
                exchange === 'execution' &&
                routingKey === BPMN_ROUTING.executeError
              ) {
                broker.publish(
                  BPMN_EXCHANGE.event,
                  BPMN_ROUTING.activityError,
                  content,
                  {
                    ...properties,
                    type: 'error',
                    mandatory: false,
                  },
                );
                if (!this.instances.has(content.executionId)) return;
              }
              if (
                exchange === 'execution' &&
                routingKey === BPMN_ROUTING.executeDiscard
              ) {
                broker.publish(
                  BPMN_EXCHANGE.event,
                  BPMN_ROUTING.activityDiscard,
                  {
                    ...content,
                    state: 'discard',
                  },
                );
                return broker.publish(
                  BPMN_EXCHANGE.execution,
                  BPMN_ROUTING.executeCompleted,
                  {
                    ...content,
                    error: undefined,
                    ktTaskDiscarded: true,
                  },
                );
              }
              return broker.publish(exchange, routingKey, content, properties);
            };
          const value = Reflect.get(target, key, target);
          if (typeof value === 'function') return value.bind(target);
          return value;
        },
      });
      activity = new Proxy(activity, {
        get: (target, key) => {
          if (key === 'broker') return instanceBroker;
          return Reflect.get(target, key, target);
        },
      });
      broker.subscribeTmp(
        BPMN_EXCHANGE.api,
        `activity.discard.${message.content.executionId}`,
        () => {
          if (this.instances.has(message.content.executionId))
            instanceBroker.publish(
              BPMN_EXCHANGE.execution,
              BPMN_ROUTING.executeDiscard,
              message.content,
            );
        },
        {
          noAck: true,
          consumerTag: `_kt-task-instance-${message.content.executionId}`,
          priority: -100,
        },
      );
    }
    if (this.activity.type === BPMN_TYPE.UserTask)
      return new UserTaskBehaviour(activity);
    return new ServiceTaskBehaviour(activity);
  }

  /**
   * 将入口令牌转换为独立执行身份，不改变业务模型的节点和连线身份。
   * @param inbound - 此实例消费的入口令牌。
   */
  private spawn(inbound: any[]): void {
    const root = this.root;
    const parent = workflowBpmnChildParent(root);
    const content = {
      ...root,
      executionId: `${root.executionId}_${randomUUID()}`,
      isRootScope: false,
      ignoreOutbound: false,
      ktTaskInstance: true,
      inbound,
      parent,
    };
    this.activity.broker.publish(
      BPMN_EXCHANGE.event,
      BPMN_ROUTING.activityExecutionStart,
      content,
    );
    this.activity.broker.publish(
      BPMN_EXCHANGE.event,
      BPMN_ROUTING.activityInstanceEnter,
      content,
    );
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeStart,
      content,
    );
  }

  /** 等当前令牌传播结束后展开排队入口，全部实例完成后才结束活动容器。 */
  private schedule(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.running) return;
      const arrivals = this.arrivals.splice(0);
      if (arrivals.length) {
        this.activity.broker.publish(
          BPMN_EXCHANGE.event,
          BPMN_ROUTING.activityEnter,
          {
            ...this.root,
            inbound: arrivals,
          },
        );
        for (const arrival of arrivals) this.spawn([arrival]);
      }
      if (this.instances.size || this.arrivals.length) return;
      this.stop();
      this.activity.broker.publish(
        BPMN_EXCHANGE.execution,
        BPMN_ROUTING.executeCompleted,
        this.root,
      );
    });
  }

  /** 撤销本实例的入口与根订阅，具体办理或脚本由引擎逐个停止。 */
  private stop(): void {
    this.running = false;
    this.activity.broker.cancel('_kt-task-completed');
    this.activity.broker.cancel('_kt-task-api');
    this.activity.broker.cancel('_kt-task-inbound');
  }
}
