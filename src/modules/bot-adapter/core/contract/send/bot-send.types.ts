import type { BotMessageType } from '../bot.types';

export interface StrictPlainTextSendInput {
  attemptNumber: number;
  deliveryId: string;
  message: string;
  selfId: string;
  targetId: string;
  targetType: BotMessageType;
}

export interface BotSendAttemptErrorOptions {
  code: string;
  message: string;
  retryable: boolean;
  sendLogId: null | string;
}
