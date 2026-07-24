import type { QqbotSendAttemptErrorOptions } from '../../contract/message-push/qqbot-message-push.types';

/** Represents a retryable or permanent strict QQBot delivery attempt failure. */
export class QqbotSendAttemptError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly sendLogId: null | string;

  /**
   * Preserves the stable retry classification and optional pending send-log identity.
   * @param options - The approved code, non-sensitive message, retry policy, and log ID.
   */
  constructor(options: QqbotSendAttemptErrorOptions) {
    super(options.message);
    this.name = 'QqbotSendAttemptError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.sendLogId = options.sendLogId;
  }
}
