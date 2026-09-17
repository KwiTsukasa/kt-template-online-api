import { BPMN_EXCHANGE, BPMN_ROUTING } from '../constants/bpmn-runtime';
import { Activity, EventBasedGateway } from 'bpmn-elements';

/**
 * 为并行实例化保留全部消息等待，普通事件网关仍由首个触发撤销竞争分支。
 * @param definition - 保留事件网关类型和实例化属性的标准定义。
 * @param context - 当前流程作用域的活动及连线上下文。
 * @returns 使用同一令牌与持久恢复机制的并行等待或排他竞争实例。
 */
export function WorkflowEventBasedGateway(definition: any, context: any) {
  if (
    definition.behaviour?.instantiate &&
    definition.behaviour.eventGatewayType === 'Parallel'
  )
    return new Activity(
      WorkflowParallelEventGatewayBehaviour,
      definition,
      context,
    );
  return EventBasedGateway(definition, context);
}

class WorkflowParallelEventGatewayBehaviour {
  private readonly broker: any;

  constructor(activity: any) {
    this.broker = activity.broker;
  }

  /**
   * 一次建立全部消息分支的等待令牌，由各捕获活动独立完成并参与流程终结判断。
   * @param message - 网关当前执行或恢复消息；活动层负责持久化已发出的顺序流。
   */
  execute(message: any): void {
    this.broker.publish(
      BPMN_EXCHANGE.execution,
      BPMN_ROUTING.executeCompleted,
      { ...message.content, requireOutbound: true },
    );
  }
}
