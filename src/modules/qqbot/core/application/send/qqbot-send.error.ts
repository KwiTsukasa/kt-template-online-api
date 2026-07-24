import type { QqbotSendAttemptErrorOptions } from '../../contract/message-push/qqbot-message-push.types';

const STRICT_SEND_ERROR_SUMMARIES: Readonly<Record<string, string>> = {
  account_unavailable: 'Configured QQBot account is unavailable',
  invalid_target_type: 'Strict QQBot delivery target type is invalid',
  onebot_disconnected: 'OneBot connection unavailable',
  onebot_rejected: 'OneBot rejected the send action',
  onebot_timeout: 'OneBot send timed out',
};

/** Maps a strict-send classification to its allowlisted non-sensitive summary. */
export function strictSendErrorSummary(code: string): string {
  return STRICT_SEND_ERROR_SUMMARIES[code] ?? 'QQBot delivery failed';
}

/** Represents a retryable or permanent strict QQBot delivery attempt failure. */
export class QqbotSendAttemptError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly sendLogId: null | string;

  /**
   * Preserves stable retry metadata while replacing all caller text with an allowlisted summary.
   * @param options - The stable code, ignored raw message, retry policy, and optional log ID.
   */
  constructor(options: QqbotSendAttemptErrorOptions) {
    super(strictSendErrorSummary(options.code));
    this.name = 'QqbotSendAttemptError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.sendLogId = options.sendLogId;
  }
}
