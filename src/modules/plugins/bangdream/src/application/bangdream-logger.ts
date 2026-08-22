/**
 * 通过 `console.info` 输出对应级别的运行日志。
 * @param type - 决定logger内容、边界或目标的 `type` 值。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 */
export function logger(type: string, message: unknown) {
  console.info(`[BangDream][${type}] ${String(message)}`);
}
