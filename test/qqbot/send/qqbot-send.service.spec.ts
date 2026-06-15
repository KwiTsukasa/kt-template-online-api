import { ToolsService } from '@/common';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';

describe('QqbotSendService', () => {
  it('stores summarized CQ image payloads while sending the original message', async () => {
    const originalMessage = `[CQ:image,file=base64://${'a'.repeat(70000)}]`;
    const reverseWsService = {
      sendAction: jest.fn().mockResolvedValue({
        data: { message_id: 'message-1' },
        retcode: 0,
        status: 'ok',
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

    const service = new QqbotSendService(
      sendLogRepository as any,
      {
        getDefaultAccount: jest.fn().mockResolvedValue({ selfId: 'bot-1' }),
      } as any,
      busService as any,
      messageService as any,
      { get: jest.fn(() => reverseWsService) } as any,
      { waitForSendSlot: jest.fn().mockResolvedValue({ waitMs: 0 }) } as any,
      new ToolsService(),
    );
    (service as any).getReverseWsService = jest
      .fn()
      .mockResolvedValue(reverseWsService);

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
    expect(reverseWsService.sendAction).toHaveBeenCalledWith(
      'bot-1',
      'send_group_msg',
      expect.objectContaining({ message: originalMessage }),
    );
    expect(messageService.saveOutgoing).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: '[CQ:image,file=base64://<70000 chars>]',
      }),
    );
  });
});
