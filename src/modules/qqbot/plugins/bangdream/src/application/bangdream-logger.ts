/**
 * 在运行时配置层中处理logger。
 *
 * @param type - type 输入；影响 logger 的返回值。
 * @param message - message 输入；驱动 `String()` 的 BangDream步骤。
 */
export function logger(type: string, message: unknown) {
  console.info(`[BangDream][${type}] ${String(message)}`);
}
