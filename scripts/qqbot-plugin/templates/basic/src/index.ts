export async function echo(input: { text?: string }) {
  return {
    replyText: input.text || 'pong',
  };
}

export async function onMessage() {
  return {
    handled: false,
  };
}
