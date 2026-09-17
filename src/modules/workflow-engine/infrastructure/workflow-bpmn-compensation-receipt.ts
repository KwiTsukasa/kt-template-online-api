import { BPMN_ROUTING } from '../constants/bpmn-runtime';
import type { Activity, ElementBrokerMessage } from 'bpmn-elements';

/**
 * 只允许成功活动实例参与补偿，显式循环按宿主整体完成，普通并发排除容器占位回执。
 * @param host - 补偿边界所附着的宿主及并发活动标记。
 * @param message - 原生收集队列或恢复快照中的完成消息。
 * @returns 消息可以由补偿捕获端处理时返回真；原生收尾标记原样放行。
 */
export function isWorkflowCompensationReceipt(
  host: Pick<Activity, 'behaviour'> & { ktConcurrentTask?: boolean },
  message: ElementBrokerMessage,
): boolean {
  const routingKey = message.fields.routingKey;
  if (routingKey === BPMN_ROUTING.executeError) return false;
  if (routingKey !== BPMN_ROUTING.executeCompleted) return true;
  const content = message.content;
  if (content.ktTaskDiscarded || content.error) return false;
  if (host?.behaviour.loopCharacteristics) return Boolean(content.isRootScope);
  return !(
    host?.ktConcurrentTask &&
    content.isRootScope &&
    content.preventComplete &&
    content.ignoreOutbound
  );
}
