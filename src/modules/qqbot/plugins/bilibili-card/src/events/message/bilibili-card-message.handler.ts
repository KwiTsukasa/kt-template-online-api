import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  return async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
