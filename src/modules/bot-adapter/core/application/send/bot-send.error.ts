import type { BotSendAttemptErrorOptions } from '../../contract/send/bot-send.types';

const STRICT_SEND_ERROR_SUMMARIES: Readonly<Record<string, string>> = {
  account_unavailable: 'Configured Bot account is unavailable',
  invalid_target_type: 'Strict Bot delivery target type is invalid',
  official_disconnected: 'QQ official Bot connection unavailable',
  official_rejected: 'QQ official Bot rejected the send request',
  official_timeout: 'QQ official Bot send timed out',
  onebot_disconnected: 'OneBot connection unavailable',
  onebot_rejected: 'OneBot rejected the send action',
  onebot_timeout: 'OneBot send timed out',
};

/**
 * 按严格发送错误代码读取稳定摘要，未知代码回退为通用 Bot 投递失败文本。
 * @param code - 决定按严格发送错误代码读取稳定摘要，未知代码回退为通用 Bot 投递失败文本内容、边界或目标的 `code` 值。
 * @returns 返回错误代码对应的稳定摘要；未知代码返回通用投递失败文本。
 */
export function strictSendErrorSummary(code: string): string {
  return STRICT_SEND_ERROR_SUMMARIES[code] ?? 'Bot delivery failed';
}

export class BotSendAttemptError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly sendLogId: null | string;

  constructor(options: BotSendAttemptErrorOptions) {
    super(strictSendErrorSummary(options.code));
    this.name = 'BotSendAttemptError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.sendLogId = options.sendLogId;
  }
}
