import { ToolsService } from '@/common';
import { BotRuleEngineService } from '@/modules/bot-adapter/core/application/send/bot-rule-engine.service';

const message = {
  eventTime: new Date(),
  messageId: 'incoming',
  messageText: '详细回复',
  messageType: 'group',
  selfId: 'qq-official:example',
  targetId: 'group',
  userId: 'member',
  rawEvent: {},
  replyMessageId: 'incoming',
  adapterReplyContext: { msgId: 'incoming', scope: 'group', targetId: 'group' },
};
const harness = (replies: unknown[]) => {
  const send = { sendText: jest.fn().mockResolvedValue({ messageId: 'sent' }) };
  const engine = new BotRuleEngineService(
    {} as any,
    { handleMessage: async () => false } as any,
    { isBlocked: async () => false, isAllowed: async () => true } as any,
    { dispatchEvent: async () => ({ handled: true, replies }) } as any,
    { listEnabledForMessage: async () => [] } as any,
    send as any,
    new ToolsService(),
  );
  return {
    send,
    run: () =>
      engine.handleMessage(message as any, { pluginKeys: ['image-test'] }),
  };
};

describe('Bot image reply delivery', () => {
  it('uses the host send queue and retains the exact incoming reply context', async () => {
    const test = harness([
      { kind: 'image', content: 'cG5n', fallbackText: '文字' },
    ]);
    await test.run();
    expect(test.send.sendText).toHaveBeenCalledTimes(1);
    expect(test.send.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '[CQ:image,file=base64://cG5n]',
        replyMessageId: 'incoming',
        adapterReplyContext: message.adapterReplyContext,
      }),
    );
  });
  it('uses only remaining reply slots after uncertain image delivery and never replays the image', async () => {
    const test = harness([
      { kind: 'image', content: 'cG5n', fallbackText: '😀'.repeat(12000) },
    ]);
    test.send.sendText.mockRejectedValueOnce(new Error('timeout'));
    await test.run();
    const sent = test.send.sendText.mock.calls.map(
      ([input]) => input.message as string,
    );
    expect(sent).toHaveLength(5);
    expect(sent.filter((text) => text.startsWith('[CQ:image'))).toHaveLength(1);
    expect(sent[1]).toContain('长图发送未确认');
    expect(sent[4]).toContain('剩余内容超出');
    expect(sent.slice(1).every((text) => Array.from(text).length <= 1800)).toBe(
      true,
    );
  });
});
