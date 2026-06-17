/**
 * 执行 脚本或 CLI流程。
 * @param input - input 输入；使用 `text` 字段生成结果。
 */
export async function echo(input: { text?: string }) {
  return {
    replyText: input.text || 'pong',
  };
}

/**
 * 处理Message。
 */
export async function onMessage() {
  return {
    handled: false,
  };
}
