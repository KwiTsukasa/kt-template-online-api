import { ToolsService } from '@/common';
import { BotSendService } from '@/modules/bot-adapter/core/application/send/bot-send.service';

describe('BotSendService', () => {
  it('stores summarized CQ image payloads while sending the original message', async () => {
    const originalMessage = `[CQ:image,file=base64://${'a'.repeat(70000)}]`;
    const adapter = {
      deliver: jest.fn().mockResolvedValue({
        deliveredAt: '2026-08-22T00:00:00.000Z',
        deliveryKey: 'message-1',
      }),
    };
    const sendLogRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => ({ ...payload, id: 'log-1' })),
      update: jest.fn(),
    };
    const messageService = {
      saveOutgoing: jest.fn(),
    };
    const busService = {
      publish: jest.fn(),
    };

    const service = new BotSendService(
      sendLogRepository as any,
      {
        getDefaultAccount: jest.fn().mockResolvedValue({
          connectionMode: 'reverse-ws',
          selfId: 'bot-1',
        }),
      } as any,
      { require: jest.fn(() => adapter) } as any,
      busService as any,
      messageService as any,
      { waitForSendSlot: jest.fn().mockResolvedValue({ waitMs: 0 }) } as any,
      new ToolsService(),
    );

    await service.sendText({
      message: originalMessage,
      selfId: 'bot-1',
      targetId: 'group-1',
      targetType: 'group',
    });

    expect(sendLogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: '[CQ:image,file=base64://<70000 chars>]',
        params: expect.objectContaining({
          message: '[CQ:image,file=base64://<70000 chars>]',
        }),
      }),
    );
    expect(busService.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({ message: originalMessage }),
      }),
    );
    expect(adapter.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionKey: 'bot-1',
        intent: { content: originalMessage, kind: 'text' },
        scope: 'group',
        targetKey: 'group-1',
      }),
    );
    expect(messageService.saveOutgoing).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: '[CQ:image,file=base64://<70000 chars>]',
      }),
    );
  });
});
