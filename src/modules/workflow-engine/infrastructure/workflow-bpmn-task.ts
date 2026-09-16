import { randomUUID } from 'node:crypto';
import { Activity } from 'bpmn-elements';
import { ServiceTaskBehaviour, UserTaskBehaviour } from 'bpmn-elements/tasks';

/**
 * 为普通业务活动的每个入口令牌创建独立实例，显式循环仍交由标准循环行为处理。
 * @param definition - 人工或工作流受控服务活动的标准定义。
 * @param context - 活动所属流程实例上下文。
 * @returns 支持重叠令牌且沿用引擎持久队列的活动。
 */
export function WorkflowConcurrentTask(definition: any, context: any) {
  let Behaviour: any = ServiceTaskBehaviour;
  if (definition.type === 'bpmn:UserTask') Behaviour = UserTaskBehaviour;
  if (definition.behaviour?.loopCharacteristics) return new Activity(Behaviour, definition, context);
  return new Activity(WorkflowConcurrentTaskBehaviour, definition, context);
}

class WorkflowConcurrentTaskBehaviour {
  private root: any;
  private arrivals: any[] = [];
  private instances = new Map<string, any>();
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
      const source = this.behaviour();
      this.instances.set(message.content.executionId, source);
      source.execute(message);
      return;
    }
    if (this.running) return;
    this.running = true;
    this.root = { ...message.content, preventComplete: true, ignoreOutbound: true };
    const broker = this.activity.broker;
    broker.subscribeTmp('execution', 'execute.completed', (_: string, completed: any) => {
      const content = completed.content;
      if (content.isRootScope) {
        this.stop();
        return;
      }
      if (completed.fields.redelivered) return;
      this.instances.delete(content.executionId);
      broker.publish('execution', 'execute.outbound.take', { ...content, ignoreOutbound: false, outbound: undefined });
      broker.publish('event', 'activity.end', { ...content, state: 'end' });
      this.schedule();
    }, { noAck: true, consumerTag: '_kt-task-completed', priority: 500 });
    broker.subscribeTmp('api', `activity.*.${this.root.executionId}`, (_: string, incoming: any) => {
      if (['stop', 'discard', 'cancel'].includes(incoming.properties.type)) this.stop();
    }, { noAck: true, consumerTag: '_kt-task-api', priority: 300 });
    broker.getQueue('inbound-q').consume((_: string, incoming: any) => {
      this.arrivals.push(structuredClone(incoming.content));
      incoming.ack();
      this.schedule();
    }, { consumerTag: '_kt-task-inbound', exclusive: true, prefetch: 1 });
    if (!message.fields.redelivered) {
      broker.publish('execution', 'execute.concurrent', this.root);
      this.spawn(message.content.inbound ?? []);
    }
    this.schedule();
  }

  /**
   * 保存未展开的入口和根身份，具体实例由引擎执行队列保存。
   * @returns 可恢复的活动状态；旧实例继续使用原行为状态。
   */
  getState() {
    if (this.legacy) return this.legacy.getState?.() ?? {};
    return { taskInstances: { root: structuredClone(this.root), arrivals: structuredClone(this.arrivals) } };
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
  }

  /**
   * 为人工办理或受控脚本选择已有引擎行为，每个实例各自保存订阅与回调。
   * @returns 当前任务类别的原生行为实例。
   */
  private behaviour(): any {
    if (this.activity.type === 'bpmn:UserTask') return new UserTaskBehaviour(this.activity);
    return new ServiceTaskBehaviour(this.activity);
  }

  /**
   * 将入口令牌转换为独立执行身份，不改变业务模型的节点和连线身份。
   * @param inbound - 此实例消费的入口令牌。
   */
  private spawn(inbound: any[]): void {
    const root = this.root;
    const parent = { id: root.id, type: root.type, executionId: root.executionId, path: [] as any[] };
    if (root.parent) parent.path = [root.parent, ...(root.parent.path ?? [])].map((item) => {
      const ancestor = { ...item };
      delete ancestor.path;
      return ancestor;
    });
    const content = { ...root, executionId: `${root.executionId}_${randomUUID()}`, isRootScope: false, ignoreOutbound: false, ktTaskInstance: true, inbound, parent };
    this.activity.broker.publish('event', 'activity.execution.start', content);
    this.activity.broker.publish('execution', 'execute.start', content);
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
        this.activity.broker.publish('event', 'activity.enter', { ...this.root, inbound: arrivals });
        for (const arrival of arrivals) this.spawn([arrival]);
      }
      if (this.instances.size || this.arrivals.length) return;
      this.stop();
      this.activity.broker.publish('execution', 'execute.completed', this.root);
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
