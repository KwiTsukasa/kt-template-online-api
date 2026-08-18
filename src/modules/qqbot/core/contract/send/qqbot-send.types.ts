import type { QqbotMessageType } from '../qqbot.types';

export interface StrictPlainTextSendInput {
  attemptNumber: number;
  deliveryId: string;
  message: string;
  selfId: string;
  targetId: string;
  targetType: QqbotMessageType;
}

export interface QqbotSendAttemptErrorOptions {
  code: string;
  message: string;
  retryable: boolean;
  sendLogId: null | string;
}
