import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

/**
 * 构造把标准化 QQBot 消息委托给 Bilibili 卡片应用服务的事件处理函数。
 * @param application - 负责解析视频链接、去重并发送卡片回复的应用服务。
 * @returns 异步消息处理函数，其布尔结果表示是否成功发送了首个有效视频卡片。
 */
export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  return /** 将标准化 QQBot 消息交给 Bilibili 卡片应用解析、去重并发送卡片回复。 @param message - 包含消息文本、发送目标和账号身份的标准化 QQBot 消息。 @returns 成功发送首个有效视频卡片时返回 `true`；消息不适用、重复或处理失败时返回 `false`。 */ async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
