import type { RepeaterApplication } from '../../application/repeater-application';
import type { RepeaterMessage } from '../../domain/repeater.types';

/**
 * 创建 复读插件对象或配置。
 * @param application - application 输入；执行 `application.handleMessage()` 对应的 模块步骤。
 */
export function createRepeaterMessageEventHandler(
  application: RepeaterApplication,
) {
  return (message: RepeaterMessage) => application.handleMessage(message);
}
