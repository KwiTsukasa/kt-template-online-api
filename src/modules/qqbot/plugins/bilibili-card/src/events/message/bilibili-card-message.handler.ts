import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

/** 创建Bilibili卡片消息处理器。 */
export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  return /** 处理消息。 */ async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
