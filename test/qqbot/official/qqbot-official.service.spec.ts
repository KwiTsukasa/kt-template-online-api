import { ToolsService } from '@/common';
import {
  type QqbotOfficialSdkLoader,
  QqbotOfficialService,
} from '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-official.service';

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('QqbotOfficialService', () => {
  it('starts Gateway only for WebSocket mode and sends normalized group events into the shared core', async () => {
    let gatewayOptions: Record<string, any> = {};
    const gatewayStart = jest.fn().mockResolvedValue(undefined);
    const gatewayConstructor = jest.fn().mockImplementation((options) => {
      gatewayOptions = options;
      return { start: gatewayStart };
    });
    const bot = createBotClient();
    const loader = jest.fn().mockResolvedValue({
      protocol: {
        FULL_INTENTS: 1174409219,
        GatewayConnection: gatewayConstructor,
        dispatchEvent: jest.fn(),
        signValidationResponse: jest.fn(),
        verifyWebhookSignature: jest.fn(),
      },
      root: { QQBot: jest.fn().mockImplementation(() => bot) },
    });
    const account = {
      connectionMode: 'official-websocket',
      enabled: true,
      officialAppId: '1020000000',
      officialAppSecretCiphertext: 'ciphertext',
      selfId: 'qq-official:1020000000',
    };
    const accountService = createAccountService(account);
    const eventService = createEventService();
    const service = createService(loader, accountService, eventService);

    await expect(service.reconcileAccount('account-1')).resolves.toEqual({
      connectionMode: 'official-websocket',
      selfId: 'qq-official:1020000000',
      started: true,
    });

    expect(gatewayConstructor).toHaveBeenCalledTimes(1);
    expect(gatewayOptions.intents).toBe(1174409219);
    expect(gatewayStart).toHaveBeenCalledTimes(1);
    gatewayOptions.onReady();
    gatewayOptions.onMessage({
      content: '<@!bot> /ping',
      groupOpenid: 'group_openid_1',
      kind: 'group',
      messageId: 'message-1',
      raw: { id: 'message-1' },
      rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      senderId: 'user_openid_1',
      senderName: '测试用户',
      timestamp: '2026-08-22T03:00:00.000Z',
    });
    gatewayOptions.onMessage({
      content: '/private',
      kind: 'c2c',
      messageId: 'message-private',
      raw: { id: 'message-private' },
      rawEventType: 'C2C_MESSAGE_CREATE',
      senderId: 'user_openid_private',
      timestamp: '2026-08-22T03:00:01.000Z',
    });
    gatewayOptions.onMessage({
      channelId: 'channel_openid_1',
      content: '<@bot> /channel',
      guildId: 'guild_openid_1',
      kind: 'guild',
      messageId: 'message-channel',
      raw: { id: 'message-channel' },
      rawEventType: 'AT_MESSAGE_CREATE',
      senderId: 'user_openid_channel',
      timestamp: '2026-08-22T03:00:02.000Z',
    });
    gatewayOptions.onMessage({
      content: '/dm',
      guildId: 'guild_openid_dm',
      kind: 'dm',
      messageId: 'message-dm',
      raw: { id: 'message-dm' },
      rawEventType: 'DIRECT_MESSAGE_CREATE',
      senderId: 'user_openid_dm',
      timestamp: '2026-08-22T03:00:03.000Z',
    });
    gatewayOptions.onMessage({
      content: '/ignore',
      kind: 'c2c',
      messageId: 'message-bot',
      raw: { id: 'message-bot' },
      rawEventType: 'C2C_MESSAGE_CREATE',
      senderId: 'bot_openid',
      senderIsBot: true,
      timestamp: '2026-08-22T03:00:04.000Z',
    });
    await flushPromises();

    expect(accountService.markOfficialOnline).toHaveBeenCalledWith(
      'qq-official:1020000000',
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionMode: 'official-websocket',
        groupId: 'group_openid_1',
        messageId: 'message-1',
        messageText: '/ping',
        messageType: 'group',
        replyMessageId: 'message-1',
        selfId: 'qq-official:1020000000',
        targetId: 'group_openid_1',
        userId: 'user_openid_1',
      }),
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message-private',
        messageType: 'private',
        targetId: 'user_openid_private',
      }),
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel_openid_1',
        guildId: 'guild_openid_1',
        messageId: 'message-channel',
        messageText: '/channel',
        messageType: 'channel',
        targetId: 'channel_openid_1',
      }),
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'guild_openid_dm',
        guildId: 'guild_openid_dm',
        messageId: 'message-dm',
        messageType: 'channel',
        targetId: 'guild_openid_dm',
      }),
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledTimes(4);
  });

  it('handles Webhook challenge, signed event ACK, invalid signatures, and CQ image sending without Gateway', async () => {
    const inboundMessage = {
      content: '/help',
      kind: 'c2c',
      messageId: 'message-2',
      raw: { id: 'message-2' },
      rawEventType: 'C2C_MESSAGE_CREATE',
      senderId: 'user_openid_2',
      timestamp: '2026-08-22T03:01:00.000Z',
    };
    const verifyWebhookSignature = jest.fn().mockReturnValue(true);
    const dispatchEvent = jest
      .fn()
      .mockReturnValue({ action: 'message', msg: inboundMessage });
    const signValidationResponse = jest.fn().mockReturnValue({
      plain_token: 'plain-token',
      signature: 'challenge-signature',
    });
    const gatewayConstructor = jest.fn();
    const bot = createBotClient();
    bot.api.getToken.mockRejectedValue(new Error('token endpoint unavailable'));
    const loader = jest.fn().mockResolvedValue({
      protocol: {
        FULL_INTENTS: 1174409219,
        GatewayConnection: gatewayConstructor,
        dispatchEvent,
        signValidationResponse,
        verifyWebhookSignature,
      },
      root: { QQBot: jest.fn().mockImplementation(() => bot) },
    });
    const account = {
      connectionMode: 'official-webhook',
      enabled: true,
      officialAppId: '1020000000',
      officialAppSecretCiphertext: 'ciphertext',
      selfId: 'qq-official:1020000000',
    };
    const accountService = createAccountService(account);
    const eventService = createEventService();
    const service = createService(loader, accountService, eventService);

    const callback = await service.getWebhookUrl('account-1');
    expect(callback.url).toMatch(
      /^https:\/\/bot\.example\.com\/api\/qqbot\/official\/webhook\/1020000000\/[a-f0-9]{64}$/,
    );
    const webhookToken = new URL(callback.url).pathname.split('/').at(-1) || '';
    expect(gatewayConstructor).not.toHaveBeenCalled();
    expect(bot.api.getToken).not.toHaveBeenCalled();

    await expect(
      service.handleWebhook({
        appId: '1020000000',
        body: Buffer.from(
          JSON.stringify({
            d: { event_ts: '1724295600', plain_token: 'plain-token' },
            op: 13,
          }),
        ),
        signature: '',
        timestamp: '',
        webhookToken,
      }),
    ).resolves.toEqual({
      body: {
        plain_token: 'plain-token',
        signature: 'challenge-signature',
      },
      status: 200,
    });
    expect(signValidationResponse).toHaveBeenCalledWith({
      botSecret: 'unit-app-secret',
      eventTs: '1724295600',
      plainToken: 'plain-token',
    });

    const eventBody = Buffer.from(
      JSON.stringify({
        d: { id: 'message-2' },
        id: 'event-2',
        op: 0,
        s: 2,
        t: 'C2C_MESSAGE_CREATE',
      }),
    );
    await expect(
      service.handleWebhook({
        appId: '1020000000',
        body: eventBody,
        signature: 'valid-signature',
        timestamp: '1724295660',
        webhookToken,
      }),
    ).resolves.toEqual({ body: { d: 0, op: 12 }, status: 200 });
    await flushPromises();
    expect(verifyWebhookSignature).toHaveBeenCalledWith({
      body: eventBody,
      botSecret: 'unit-app-secret',
      signature: 'valid-signature',
      timestamp: '1724295660',
    });
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionMode: 'official-webhook',
        messageType: 'private',
        targetId: 'user_openid_2',
      }),
    );

    verifyWebhookSignature.mockReturnValueOnce(false);
    await expect(
      service.handleWebhook({
        appId: '1020000000',
        body: eventBody,
        signature: 'invalid-signature',
        timestamp: '1724295661',
        webhookToken,
      }),
    ).resolves.toEqual({
      body: { error: 'invalid signature' },
      status: 401,
    });

    await expect(
      service.sendText({
        message: '[CQ:image,file=https://img.example.com/cover.jpg]\n封面',
        selfId: 'qq-official:1020000000',
        targetId: 'group_openid_2',
        targetType: 'group',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'official-image-message' }),
    );
    expect(bot.sendImage).toHaveBeenCalledWith(
      { scope: 'group', targetId: 'group_openid_2' },
      { url: 'https://img.example.com/cover.jpg' },
      { content: '封面' },
    );

    await service.sendText({
      channelId: 'channel_openid_2',
      guildId: 'guild_openid_2',
      message: '频道回复',
      replyMessageId: 'message-channel-2',
      selfId: 'qq-official:1020000000',
      targetId: 'channel_openid_2',
      targetType: 'channel',
    });
    expect(bot.sendChannelMessage).toHaveBeenCalledWith(
      'channel_openid_2',
      '频道回复',
      { msgId: 'message-channel-2' },
    );

    await service.sendText({
      channelId: 'guild_openid_dm_2',
      guildId: 'guild_openid_dm_2',
      message: '频道私信回复',
      replyMessageId: 'message-dm-2',
      selfId: 'qq-official:1020000000',
      targetId: 'guild_openid_dm_2',
      targetType: 'channel',
    });
    expect(bot.sendDmMessage).toHaveBeenCalledWith(
      'guild_openid_dm_2',
      '频道私信回复',
      { msgId: 'message-dm-2' },
    );
  });
});

const createBotClient = () => ({
  api: { getToken: jest.fn().mockResolvedValue('access-token') },
  messageApi: {
    getGatewayUrl: jest.fn().mockResolvedValue('wss://gateway.example.com'),
  },
  sendChannelMessage: jest.fn().mockResolvedValue({
    id: 'official-channel-message',
    timestamp: 1,
  }),
  sendDmMessage: jest.fn().mockResolvedValue({
    id: 'official-dm-message',
    timestamp: 1,
  }),
  sendImage: jest.fn().mockResolvedValue({
    message: {
      id: 'official-image-message',
      timestamp: 1,
    },
    upload: { file_info: 'file-info' },
  }),
  sendText: jest.fn().mockResolvedValue({
    id: 'official-text-message',
    timestamp: 1,
  }),
  tokenManager: {
    clearCache: jest.fn(),
    startBackgroundRefresh: jest.fn(),
    stopBackgroundRefresh: jest.fn(),
  },
});

const createAccountService = (account: Record<string, unknown>) => ({
  allEnabledOfficialWithSecret: jest.fn().mockResolvedValue([account]),
  findByIdWithOfficialSecret: jest.fn().mockResolvedValue(account),
  findEnabledOfficialByAppIdWithSecret: jest.fn().mockResolvedValue(account),
  findEnabledOfficialBySelfIdWithSecret: jest.fn().mockResolvedValue(account),
  getOfficialAppSecret: jest.fn().mockReturnValue('unit-app-secret'),
  markOfficialActivity: jest.fn().mockResolvedValue(undefined),
  markOfficialOffline: jest.fn().mockResolvedValue(undefined),
  markOfficialOnline: jest.fn().mockResolvedValue(undefined),
});

const createEventService = () => ({
  handleNormalizedMessage: jest.fn(),
  handleRawEvent: jest.fn(),
});

const createService = (
  loader: jest.MockedFunction<QqbotOfficialSdkLoader>,
  accountService: ReturnType<typeof createAccountService>,
  eventService: ReturnType<typeof createEventService>,
) =>
  new QqbotOfficialService(
    loader,
    accountService as never,
    {
      get: jest.fn((key: string) => {
        if (key === 'QQBOT_OFFICIAL_WEBHOOK_PUBLIC_BASE_URL') {
          return 'https://bot.example.com/api';
        }
        return undefined;
      }),
    } as never,
    eventService as never,
    new ToolsService(),
  );
