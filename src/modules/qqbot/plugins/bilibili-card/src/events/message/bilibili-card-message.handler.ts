import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

/**
 * Creates the message event handler for the Bilibili card plugin.
 * @param application - Application service that owns parsing and reply orchestration.
 * @returns Handler accepted by the plugin package entry.
 */
export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  /**
   * Handles one normalized QQBot message event.
   * @param message - Normalized QQBot message forwarded by the plugin platform.
   * @returns Whether the plugin sent a reply.
   */
  return async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
