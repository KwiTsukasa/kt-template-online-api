/**
 * 将示例输入中的非空文本映射为插件回复，文本为空时固定回复 `pong`。
 * @param input - 插件示例输入；`text` 指定要原样回复的文本。
 * @returns 含回复文本的结果；`text` 缺失或为空时 `replyText` 为 `pong`。
 */
export async function echo(input: { text?: string }) {
  return {
    replyText: input.text || 'pong',
  };
}

/**
 * 基础插件模板收到消息时不消费内容，并固定报告事件未处理。
 * @returns 始终含 `handled: false` 的事件结果，表示宿主可以继续分发该消息。
 */
export async function onMessage() {
  return {
    handled: false,
  };
}
