import { NapcatBotProtocolAdapter } from '../../../src/modules/bot-adapter/napcat/infrastructure/napcat-bot-protocol.adapter';

const deliveryRequest = {
  connectionKey: '10001',
  conversationKey: 'group:20001',
  intent: { content: 'plain text', kind: 'text' as const },
  scope: 'group' as const,
  targetKey: '20001',
};

describe('NapCat Bot protocol adapter', () => {
  it('registers and unregisters only its protocol adapter instance', () => {
    const registry = {
      register: jest.fn(),
      unregister: jest.fn(),
    };
    const adapter = new NapcatBotProtocolAdapter(
      registry as any,
      {} as any,
      {} as any,
    );

    adapter.onModuleInit();
    adapter.onModuleDestroy();

    expect(registry.register).toHaveBeenCalledWith(adapter);
    expect(registry.unregister).toHaveBeenCalledWith('napcat');
  });

  it('projects successful OneBot delivery into the platform-neutral result', async () => {
    const reverseWsService = {
      sendAction: jest.fn().mockResolvedValue({
        data: { message_id: 'message-1' },
        retcode: 0,
        status: 'ok',
      }),
    };
    const adapter = new NapcatBotProtocolAdapter(
      {} as any,
      reverseWsService as any,
      {} as any,
    );

    await expect(adapter.deliver(deliveryRequest)).resolves.toMatchObject({
      deliveryKey: 'message-1',
    });
    expect(reverseWsService.sendAction).toHaveBeenCalledWith(
      '10001',
      'send_group_msg',
      {
        group_id: '20001',
        message: [{ data: { text: 'plain text' }, type: 'text' }],
      },
    );
  });

  it.each([
    ['failed status despite zero retcode', { retcode: 0, status: 'failed' }],
    ['ok status with nonzero retcode', { retcode: 1404, status: 'ok' }],
    ['missing status', { retcode: 0 }],
    ['missing retcode', { status: 'ok' }],
  ])(
    'rejects %s as a permanent protocol delivery failure',
    async (_label, response) => {
      const adapter = new NapcatBotProtocolAdapter(
        {} as any,
        {
          sendAction: jest.fn().mockResolvedValue({
            message: 'bad target',
            ...response,
          }),
        } as any,
        {} as any,
      );

      await expect(adapter.deliver(deliveryRequest)).rejects.toMatchObject({
        code: 'onebot_rejected',
        name: 'BotReverseWsActionError',
      });
    },
  );
});
