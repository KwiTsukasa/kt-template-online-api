import { requireExecutionState } from '@/common/automation/validation';
import {
  BPMN_EXCHANGE,
  BPMN_ROUTING,
  BPMN_QUEUE,
} from '../constants/bpmn-runtime';
import { WORKFLOW_BPMN_LIMITS } from '@/modules/workflow-engine/constants/bpmn';
import { Activity } from 'bpmn-elements';

import { WorkflowBpmnFlowIndex } from './workflow-bpmn-flow-index';

interface ComplexState {
  waitingForStart: boolean;
  tokens: Record<string, number>;
  consumed: string[];
  arrivals?: any[];
}

/**
 * 为复杂网关建立独立于并行汇合的两阶段令牌执行器，状态随活动快照恢复。
 * @param definition - 含激活条件与默认出口的标准网关定义。
 * @param context - 当前流程或子流程实例的活动上下文。
 * @returns 使用引擎活动生命周期的复杂网关。
 */
export function WorkflowComplexGateway(definition: any, context: any) {
  return new Activity(WorkflowComplexGatewayBehaviour, definition, context);
}

class WorkflowComplexGatewayBehaviour {
  private state: ComplexState = {
    waitingForStart: true,
    tokens: {},
    consumed: [],
  };
  private message: any;
  private running = false;
  private scheduled = false;
  private peers: any[] = [];
  private readonly flows: WorkflowBpmnFlowIndex;

  constructor(
    readonly activity: any,
    private readonly context: any,
  ) {
    this.flows = new WorkflowBpmnFlowIndex(
      context.getSequenceFlows(activity.parent.id),
    );
  }

  /**
   * 首次到达时保存入口令牌，恢复时仅重新连接监听器，不重复接收或发送令牌。
   * @param message - 当前执行消息或已持久化的恢复消息。
   */
  execute(message: any): void {
    if (this.running) return;
    this.message = message;
    this.running = true;
    const broker = this.activity.broker;
    if (!Object.keys(this.state.tokens).length) {
      for (const flow of this.activity.inbound) this.state.tokens[flow.id] = 0;
      for (const inbound of message.content.inbound ?? [])
        this.receive(inbound.id);
    }
    this.peers = this.context
      .getActivities(this.activity.parent.id)
      .filter((peer: any) => peer.id !== this.activity.id);
    for (const peer of this.peers)
      peer.broker.subscribeTmp(
        BPMN_EXCHANGE.event,
        BPMN_ROUTING.activityAll,
        () => this.schedule(),
        {
          noAck: true,
          consumerTag: `_kt-complex-${this.activity.id}`,
        },
      );
    broker.subscribeTmp(
      BPMN_EXCHANGE.api,
      `activity.*.${message.content.executionId}`,
      (_: string, incoming: any) => {
        if (['stop', 'discard', 'cancel'].includes(incoming.properties.type))
          this.stop();
      },
      { noAck: true, consumerTag: '_kt-complex-api', priority: 300 },
    );
    broker.getQueue(BPMN_QUEUE.inbound).consume(
      (_: string, inbound: any) => {
        this.receive(inbound.content.id);
        (this.state.arrivals ??= []).push(structuredClone(inbound.content));
        inbound.ack();
        this.schedule();
      },
      { consumerTag: '_kt-complex-inbound', exclusive: true, prefetch: 1 },
    );
    this.schedule();
  }

  /**
   * 返回可 JSON 序列化的令牌计数和本轮消费集合，避免恢复时重新触发已放行的分支。
   * @returns 当前复杂网关执行快照。
   */
  getState() {
    return { complexGateway: structuredClone(this.state) };
  }

  /**
   * 将快照中的入口计数与已消费集合装回当前实例，防止服务重启造成重复放行。
   * @param snapshot - 引擎持久化的活动执行状态。
   */
  recover(snapshot: any): void {
    if (snapshot?.complexGateway)
      this.state = structuredClone(snapshot.complexGateway);
  }

  /**
   * 仅接收声明的入口令牌，重复入口留在队列计数中等待下一轮消费。
   * @param flowId - 当前到达的顺序流标识。
   */
  private receive(flowId: string): void {
    if (Object.hasOwn(this.state.tokens, flowId))
      this.state.tokens[flowId] += 1;
  }

  /** 等当前同步令牌传播结束后再判断缺失分支，避免将正在转移的令牌判为不存在。 */
  private schedule(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.running) return;
      try {
        this.advance();
      } catch (error) {
        this.stop();
        this.activity.broker.publish(
          BPMN_EXCHANGE.execution,
          BPMN_ROUTING.executeError,
          {
            ...this.message.content,
            error,
          },
        );
      }
    });
  }

  /**
   * 将当前入口计数和阶段传入有限表达式，业务变量仍由现有环境解析。
   * @returns 本阶段条件共用的执行消息。
   */
  private phaseMessage() {
    return {
      ...this.message,
      content: {
        ...this.message.content,
        activationCount: { ...this.state.tokens },
        waitingForStart: this.state.waitingForStart,
      },
    };
  }

  /**
   * 每轮只消费每个有令牌入口的一份令牌，晚到的其他分支用于重置而非再次激活。
   * @throws 激活条件不返回布尔值或无等待回环超出安全界限时拒绝推进。
   */
  private advance(): void {
    if (this.state.arrivals?.length) {
      const inbound = this.state.arrivals;
      this.state.arrivals = [];
      // 入口已转交给此活动；同步流传播结束后通知父流程移除对应的在途令牌。
      this.activity.broker.publish(
        BPMN_EXCHANGE.event,
        BPMN_ROUTING.activityEnter,
        {
          ...this.message.content,
          inbound,
        },
      );
    }
    for (
      let cycle = 0;
      cycle < WORKFLOW_BPMN_LIMITS.synchronousTransitions && this.running;
      cycle += 1
    ) {
      const phase = this.phaseMessage();
      if (!this.state.waitingForStart) {
        if (!this.canReset()) return;
        const consumed = new Set(this.state.consumed);
        for (const [id, count] of Object.entries(this.state.tokens)) {
          if (consumed.has(id) || count <= 0) continue;
          this.state.tokens[id] -= 1;
        }
        this.state.consumed = [];
        this.state.waitingForStart = true;
        this.send(phase, false);
        continue;
      }
      if (!Object.values(this.state.tokens).some((count) => count > 0)) {
        this.complete();
        return;
      }
      const active = this.activity.environment.resolveExpression(
        this.activity.behaviour.activationCondition.body,
        phase,
      );
      requireExecutionState(
        typeof active === 'boolean',
        '复杂网关激活条件必须返回布尔值',
      );
      if (!active) return;
      this.state.consumed = Object.keys(this.state.tokens).filter(
        (id) => this.state.tokens[id] > 0,
      );
      for (const id of this.state.consumed) this.state.tokens[id] -= 1;
      this.state.waitingForStart = false;
      this.send(phase, true);
    }
    requireExecutionState(!this.running, '复杂网关同步推进超过安全上限');
  }

  /**
   * 按当前作用域内仍活动的令牌路径判断缺失入口，已有令牌或本轮消费入口均参与包容汇合判断。
   * @returns 不再存在只能到达缺失入口的活动分支时允许重置。
   */
  private canReset(): boolean {
    const received = new Set(this.state.consumed);
    for (const [id, count] of Object.entries(this.state.tokens))
      if (count > 0) received.add(id);
    const missing = this.activity.inbound.filter(
      (flow: any) => !received.has(flow.id),
    );
    if (!missing.length) return true;
    const missingOrigins = this.flows.originsBefore(
      this.activity.id,
      missing.map((flow: any) => flow.id),
    );
    const receivedOrigins = this.flows.originsBefore(
      this.activity.id,
      received,
    );
    for (const peer of this.peers) {
      if (
        !peer.status &&
        !peer.initialized &&
        !peer.broker.getQueue(BPMN_QUEUE.inbound)?.messageCount
      )
        continue;
      if (missingOrigins.has(peer.id) && !receivedOrigins.has(peer.id))
        return false;
    }
    return true;
  }

  /**
   * 放行条件出口而保留网关实例，只有激活阶段要求至少一条条件或默认路径成立。
   * @param phase - 消费令牌前的阶段与入口计数。
   * @param requireOutbound - 只有激活阶段强制至少一个出口成立。
   */
  private send(phase: any, requireOutbound: boolean): void {
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeOutboundTake,
      {
        ...phase.content,
        requireOutbound,
        outbound: undefined,
      },
    );
  }

  /** 将已重置且无剩余令牌的网关标记为结束，并阻止活动离开时再次发送出口。 */
  private complete(): void {
    this.stop();
    this.activity.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompleted,
      {
        ...this.message.content,
        ignoreOutbound: true,
      },
    );
  }

  /** 停止本实例的入口及同作用域监听，保留持久状态供恢复，不影响其他网关。 */
  private stop(): void {
    this.running = false;
    this.activity.broker.cancel('_kt-complex-inbound');
    this.activity.broker.cancel('_kt-complex-api');
    for (const peer of this.peers)
      peer.broker.cancel(`_kt-complex-${this.activity.id}`);
  }
}
