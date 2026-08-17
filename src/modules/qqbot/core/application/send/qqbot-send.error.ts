import type { QqbotSendAttemptErrorOptions } from '../../contract/message-push/qqbot-message-push.types';

const STRICT_SEND_ERROR_SUMMARIES: Readonly<Record<string, string>> = {
  account_unavailable: 'Configured QQBot account is unavailable',
  invalid_target_type: 'Strict QQBot delivery target type is invalid',
  onebot_disconnected: 'OneBot connection unavailable',
  onebot_rejected: 'OneBot rejected the send action',
  onebot_timeout: 'OneBot send timed out',
};

/**
 * 按严格发送错误代码读取稳定摘要，未知代码回退为通用 QQBot 投递失败文本。
 * @param code - 决定按严格发送错误代码读取稳定摘要，未知代码回退为通用 QQBot 投递失败文本内容、边界或目标的 `code` 值。
 * @returns 返回错误代码对应的稳定摘要；未知代码返回通用投递失败文本。
 */
export function strictSendErrorSummary(code: string): string {
  return STRICT_SEND_ERROR_SUMMARIES[code] ?? 'QQBot delivery failed';
}

export class QqbotSendAttemptError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly sendLogId: null | string;

  constructor(options: QqbotSendAttemptErrorOptions) {
    super(strictSendErrorSummary(options.code));
    this.name = 'QqbotSendAttemptError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.sendLogId = options.sendLogId;
  }
}
