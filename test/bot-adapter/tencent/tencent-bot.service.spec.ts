import { ToolsService } from '@/common';
import {
  type TencentBotSdkLoader,
  TencentBotService,
} from '@/modules/bot-adapter/tencent/infrastructure/tencent-bot.service';

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('TencentBotService', () => {
  it('starts Gateway only for WebSocket mode and sends normalized group events into the shared core', async () => {
    const eventHandlers = new Map<string, (...args: any[]) => unknown>();
    const bot = createBotClient(eventHandlers);
    const loader = jest.fn().mockResolvedValue({
      protocol: {
        FULL_INTENTS: 1174409219,
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

    expect(bot.start).toHaveBeenCalledTimes(1);
    await eventHandlers.get('ready')?.();
    await eventHandlers.get('message')?.(
      {},
      {
        content: '<@!bot> /ping',
        groupOpenid: 'group_openid_1',
        kind: 'group',
        messageId: 'message-1',
        raw: { id: 'message-1' },
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        replyTarget: {
          msgId: 'message-1',
          scope: 'group',
          targetId: 'group_openid_1',
        },
        senderId: 'user_openid_1',
        senderName: '测试用户',
        timestamp: '2026-08-22T03:00:00.000Z',
      },
    );
    await eventHandlers.get('message')?.(
      {},
      {
        content: '/private',
        kind: 'c2c',
        messageId: 'message-private',
        raw: { id: 'message-private' },
        rawEventType: 'C2C_MESSAGE_CREATE',
        replyTarget: {
          msgId: 'message-private',
          scope: 'c2c',
          targetId: 'user_openid_private',
        },
        senderId: 'user_openid_private',
        timestamp: '2026-08-22T03:00:01.000Z',
      },
    );
    await eventHandlers.get('message')?.(
      {},
      {
        channelId: 'channel_openid_1',
        content: '<@bot> /channel',
        guildId: 'guild_openid_1',
        kind: 'guild',
        messageId: 'message-channel',
        raw: { id: 'message-channel' },
        rawEventType: 'AT_MESSAGE_CREATE',
        senderId: 'user_openid_channel',
        timestamp: '2026-08-22T03:00:02.000Z',
      },
    );
    await eventHandlers.get('message')?.(
      {},
      {
        content: '/dm',
        guildId: 'guild_openid_dm',
        kind: 'dm',
        messageId: 'message-dm',
        raw: { id: 'message-dm' },
        rawEventType: 'DIRECT_MESSAGE_CREATE',
        senderId: 'user_openid_dm',
        timestamp: '2026-08-22T03:00:03.000Z',
      },
    );
    await eventHandlers.get('message')?.(
      {},
      {
        content: '/ignore',
        kind: 'c2c',
        messageId: 'message-bot',
        raw: { id: 'message-bot' },
        rawEventType: 'C2C_MESSAGE_CREATE',
        senderId: 'bot_openid',
        senderIsBot: true,
        timestamp: '2026-08-22T03:00:04.000Z',
      },
    );
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
        adapterReplyContext: {
          msgId: 'message-1',
          scope: 'group',
          targetId: 'group_openid_1',
        },
        replyMessageId: 'message-1',
        selfId: 'qq-official:1020000000',
        targetId: 'group_openid_1',
        userId: 'user_openid_1',
      }),
      { pluginKeys: [] },
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message-private',
        messageType: 'private',
        adapterReplyContext: {
          msgId: 'message-private',
          scope: 'c2c',
          targetId: 'user_openid_private',
        },
        targetId: 'user_openid_private',
      }),
      { pluginKeys: [] },
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
      { pluginKeys: [] },
    );
    expect(eventService.handleNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'guild_openid_dm',
        guildId: 'guild_openid_dm',
        messageId: 'message-dm',
        messageType: 'channel',
        targetId: 'guild_openid_dm',
      }),
      { pluginKeys: [] },
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
      /^https:\/\/bot\.example\.com\/api\/bot-adapter\/tencent\/webhook\/1020000000\/[a-f0-9]{64}$/,
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
      { pluginKeys: [] },
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
      message: '被动回复',
      adapterReplyContext: {
        msgId: 'message-c2c-2',
        scope: 'c2c',
        targetId: 'user_openid_2',
      },
      replyMessageId: 'message-c2c-2',
      selfId: 'qq-official:1020000000',
      targetId: 'user_openid_2',
      targetType: 'private',
    });
    expect(bot.sendText).toHaveBeenCalledWith(
      {
        msgId: 'message-c2c-2',
        scope: 'c2c',
        targetId: 'user_openid_2',
      },
      '被动回复',
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

  it('accepts only QQ official Webhook ports and rejects the old dynamic NAS port', async () => {
    const bot = createBotClient();
    const loader = jest.fn().mockResolvedValue({
      protocol: {
        FULL_INTENTS: 1174409219,
        dispatchEvent: jest.fn(),
        signValidationResponse: jest.fn(),
        verifyWebhookSignature: jest.fn(),
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
    const allowed = createService(
      loader,
      accountService,
      eventService,
      'https://bot.example.com:8443/api',
    );
    await expect(allowed.getWebhookUrl('account-1')).resolves.toEqual({
      url: expect.stringMatching(
        /^https:\/\/bot\.example\.com:8443\/api\/bot-adapter\/tencent\/webhook\//,
      ),
    });

    const invalid = createService(
      loader,
      accountService,
      eventService,
      'https://bot.example.com:51524/api',
    );
    await expect(invalid.getWebhookUrl('account-1')).rejects.toThrow(
      '端口为 80/443/8080/8443',
    );
  });

  it('preserves foreign official menu resources and makes the second menu sync write-free', async () => {
    const bot = createBotClient();
    let menuItems: any[] = [
      { name: 'KT·1旧', send_message: '/old', type: 'send_message' },
      { name: '帮助', send_message: '/help', type: 'send_message' },
    ];
    const panels = new Map<string, any[]>([
      [
        'c2c',
        [
          {
            panel: {
              items: [
                {
                  desc: '旧指令',
                  name: '/old',
                  only_admin: false,
                  type: 'command',
                },
              ],
              remark: 'kt-plugin-menu:v1:c2c',
            },
            panel_id: 'managed-primary',
          },
          {
            panel: {
              items: [],
              remark: 'kt-plugin-menu:v1:c2c',
            },
            panel_id: 'managed-duplicate',
          },
          {
            panel: { items: [], remark: 'foreign-panel' },
            panel_id: 'foreign-panel',
          },
        ],
      ],
      ['group', []],
      ['channel', []],
      ['dm', []],
    ]);
    bot.api.get.mockImplementation(async (path: string, query?: any) => {
      if (path === '/v2/menu') {
        return {
          menu: {
            items: menuItems.map((item) => ({
              ...item,
              icon: 'https://bot.example.com/default-menu-icon.png',
            })),
          },
          version: 1,
        };
      }
      if (path === '/v2/panels') {
        return {
          is_end: true,
          next_cursor: '',
          records: (panels.get(query?.scope) || []).map((record) => ({
            ...record,
            panel: {
              ...record.panel,
              items: (record.panel.items || []).map((item: any) => {
                const normalized = { ...item };
                if (normalized.only_admin === false) {
                  delete normalized.only_admin;
                }
                return normalized;
              }),
            },
          })),
        };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    bot.api.put.mockImplementation(async (path: string, body: any) => {
      if (path === '/v2/menu') {
        menuItems = body.menu.items;
        return { version: 2 };
      }
      const panelId = path.split('/').at(-1) || '';
      panels.forEach((records) => {
        const record = records.find((item) => item.panel_id === panelId);
        if (record) record.panel = body.panel;
      });
      return { version: 2 };
    });
    bot.api.post.mockImplementation(async (_path: string, body: any) => {
      const panelId = `created-${body.scope}`;
      panels.get(body.scope)?.push({ panel: body.panel, panel_id: panelId });
      return { panel_id: panelId };
    });
    bot.api.delete.mockImplementation(async (path: string) => {
      const panelId = path.split('/').at(-1) || '';
      panels.forEach((records, scope) => {
        panels.set(
          scope,
          records.filter((item) => item.panel_id !== panelId),
        );
      });
      return undefined;
    });
    const account = {
      connectionMode: 'official-websocket',
      enabled: true,
      officialAppId: '1020000000',
      officialAppSecretCiphertext: 'ciphertext',
      selfId: 'qq-official:1020000000',
    };
    const service = createService(
      jest.fn().mockResolvedValue({
        protocol: {
          FULL_INTENTS: 1174409219,
          dispatchEvent: jest.fn(),
          signValidationResponse: jest.fn(),
          verifyWebhookSignature: jest.fn(),
        },
        root: { QQBot: jest.fn().mockImplementation(() => bot) },
      }),
      createAccountService(account),
      createEventService(),
    );
    const command = {
      desc: '查询状态',
      name: 'status',
      only_admin: false,
      type: 'command' as const,
    };
    const projection = {
      menuItems: [
        {
          name: 'KT·1状态',
          sub_menu_items: [
            {
              name: '状态',
              send_message: '/status',
              type: 'send_message' as const,
            },
          ],
          type: 'menu' as const,
        },
      ],
      panels: {
        c2c: [command],
        channel: [],
        dm: [],
        group: [command],
      },
    };

    await service.reconcileAccount('account-1');
    await expect(
      service.syncPluginMenus({
        projection,
        selfId: 'qq-official:1020000000',
      }),
    ).resolves.toEqual({
      menuUpdated: 1,
      panelsCreated: 1,
      panelsDeleted: 1,
      panelsUpdated: 1,
    });
    expect(menuItems).toEqual([
      projection.menuItems[0],
      {
        icon: 'https://bot.example.com/default-menu-icon.png',
        name: '帮助',
        send_message: '/help',
        type: 'send_message',
      },
    ]);
    expect(
      panels.get('c2c')?.some((item) => item.panel_id === 'foreign-panel'),
    ).toBe(true);
    expect(bot.api.get).toHaveBeenCalledWith('/v2/menu');
    for (const scope of ['c2c', 'group', 'channel', 'dm']) {
      expect(bot.api.get).toHaveBeenCalledWith('/v2/panels', {
        limit: 50,
        scope,
      });
    }
    const writeCount =
      bot.api.put.mock.calls.length +
      bot.api.post.mock.calls.length +
      bot.api.delete.mock.calls.length;

    await expect(
      service.syncPluginMenus({
        projection,
        selfId: 'qq-official:1020000000',
      }),
    ).resolves.toEqual({
      menuUpdated: 0,
      panelsCreated: 0,
      panelsDeleted: 0,
      panelsUpdated: 0,
    });
    expect(
      bot.api.put.mock.calls.length +
        bot.api.post.mock.calls.length +
        bot.api.delete.mock.calls.length,
    ).toBe(writeCount);
  });
});

const createBotClient = (
  eventHandlers = new Map<string, (...args: any[]) => unknown>(),
) => {
  const bot = {
    api: {
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      getToken: jest.fn().mockResolvedValue('access-token'),
      post: jest.fn(),
      put: jest.fn(),
    },
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
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    tokenManager: {
      clearCache: jest.fn(),
      startBackgroundRefresh: jest.fn(),
      stopBackgroundRefresh: jest.fn(),
    },
  };
  bot.on.mockImplementation((event, handler) => {
    eventHandlers.set(event, handler);
    return bot;
  });
  return bot;
};

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
  loader: jest.MockedFunction<TencentBotSdkLoader>,
  accountService: ReturnType<typeof createAccountService>,
  eventService: ReturnType<typeof createEventService>,
  webhookBaseUrl = 'https://bot.example.com/api',
) =>
  new TencentBotService(
    loader,
    accountService as never,
    {
      get: jest.fn((key: string) => {
        if (key === 'TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL') {
          return webhookBaseUrl;
        }
        return undefined;
      }),
    } as never,
    eventService as never,
    new ToolsService(),
    {
      listBoundPluginKeys: jest.fn().mockResolvedValue([]),
    } as never,
  );
