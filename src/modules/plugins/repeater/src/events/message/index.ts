import type { RepeaterApplication } from '../../application/repeater-application';
import type { RepeaterMessage } from '../../domain/repeater.types';

/**
 * 根据`application`构造Repeater消息事件Handler。
 * @param application - 用于Repeater消息事件Handler的领域对象，包含 `handleMessage` 字段。
 * @returns Repeater消息事件Handler。
 */
export function createRepeaterMessageEventHandler(
  application: RepeaterApplication,
) {
  return (message: RepeaterMessage) => application.handleMessage(message);
}
