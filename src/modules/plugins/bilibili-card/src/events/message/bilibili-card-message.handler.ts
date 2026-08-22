import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

/**
 * 构造把平台无关消息事件委托给 Bilibili 卡片应用服务的处理函数。
 * @param application - 负责解析视频链接、去重并生成回复意图的应用服务。
 * @returns 异步消息处理函数，其结果由 Bot 适配器负责发送。
 */
export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  return /** 将平台无关消息交给 Bilibili 卡片应用解析并生成回复意图。 @param message - 包含 opaque 会话键、正文和链接的插件事件。 @returns 标准插件事件结果。 */ async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
