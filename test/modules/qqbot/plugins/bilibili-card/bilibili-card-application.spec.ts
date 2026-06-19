import { BilibiliCardApplication } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/application/bilibili-card-application';
import type {
  BilibiliCardManifest,
  BilibiliCardMessage,
  BilibiliCardPluginHost,
} from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types';
import { createPlugin } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/index';

describe('Bilibili card application', () => {
  it('does nothing when plugin is not bound to account', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue([]),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
        }),
      ),
    ).resolves.toBe(false);

    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });

  it('warns and returns false when binding lookup fails', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest
        .fn()
        .mockRejectedValue(new Error('binding down')),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
        }),
      ),
    ).resolves.toBe(false);

    expect(host.warn).toHaveBeenCalledWith(
      expect.stringContaining('binding down'),
    );
    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });

  it('ignores messages sent by the bot itself', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          selfId: '10001',
          userId: '10001',
        }),
      ),
    ).resolves.toBe(false);

    expect(host.getBoundEventPluginKeys).not.toHaveBeenCalled();
    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });

  it('fetches video info and sends one summary for bound account', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      requestJson: jest.fn().mockResolvedValue(createBilibiliViewResponse()),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          channelId: 'channel-1',
          messageText: '看看 https://www.bilibili.com/video/BV1xx411c7mD',
          rawEvent: { guild_id: 987654321 },
          targetId: 'group-1',
        }),
      ),
    ).resolves.toBe(true);

    expect(host.requestJson).toHaveBeenCalledTimes(1);
    expect(host.sendText).toHaveBeenCalledTimes(1);
    expect(host.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        guildId: '987654321',
        message: expect.stringContaining('标题：夏祭'),
        selfId: '10001',
        targetId: 'group-1',
        targetType: 'group',
      }),
    );
  });

  it('resolves b23.tv short links before fetching video info', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      requestJson: jest.fn().mockResolvedValue(createBilibiliViewResponse()),
      resolveRedirect: jest.fn().mockResolvedValue({
        finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        redirects: ['https://b23.tv/abc123'],
      }),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://b23.tv/abc123',
        }),
      ),
    ).resolves.toBe(true);

    expect(host.resolveRedirect).toHaveBeenCalledWith({
      maxRedirects: 5,
      timeoutMs: 6000,
      url: 'https://b23.tv/abc123',
    });
    expect(host.requestJson).toHaveBeenCalledTimes(1);
  });

  it('deduplicates same video in same conversation during TTL', async () => {
    let current = 1000;
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      requestJson: jest.fn().mockResolvedValue(createBilibiliViewResponse()),
    });
    const application = new BilibiliCardApplication(
      host,
      createManifest(),
      () => current,
    );
    const message = createMessage({
      messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
    });

    await expect(application.handleMessage(message)).resolves.toBe(true);
    current += 1000;
    await expect(application.handleMessage(message)).resolves.toBe(false);

    expect(host.requestJson).toHaveBeenCalledTimes(1);
    expect(host.sendText).toHaveBeenCalledTimes(1);
  });

  it('routes generic worker message events to package handler', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      requestJson: jest.fn().mockResolvedValue(createBilibiliViewResponse()),
    });
    const plugin = createPlugin({
      host,
      manifest: createManifest(),
    });

    await expect(
      plugin.handleEvent(
        'message',
        createMessage({
          messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
        }),
      ),
    ).resolves.toBe(true);

    expect(host.sendText).toHaveBeenCalledTimes(1);
  });

  it('returns false for non-video or invalid URLs without HTTP or send', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText:
            'https://space.bilibili.com/1 https://example.com/video/BV1xx411c7mD',
        }),
      ),
    ).resolves.toBe(false);

    expect(host.resolveRedirect).not.toHaveBeenCalled();
    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });

  it('returns false when warning throws during binding lookup failure', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest
        .fn()
        .mockRejectedValue(new Error('binding down')),
      warn: jest.fn(() => {
        throw new Error('logger down');
      }),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
        }),
      ),
    ).resolves.toBe(false);
  });

  it('returns false when warning throws during short-link failure', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      resolveRedirect: jest.fn().mockRejectedValue(new Error('redirect down')),
      warn: jest.fn(() => {
        throw new Error('logger down');
      }),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://b23.tv/abc123',
        }),
      ),
    ).resolves.toBe(false);
  });

  it('attaches a rejection handler when warning returns a promise', async () => {
    const catchSpy = jest.fn();
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      resolveRedirect: jest.fn().mockRejectedValue(new Error('redirect down')),
      warn: jest.fn(
        () =>
          ({
            catch: catchSpy,
          }) as unknown as void,
      ),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://b23.tv/abc123',
        }),
      ),
    ).resolves.toBe(false);

    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('warns and returns false when short-link resolution fails', async () => {
    const host = createHost({
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['bilibili-card']),
      resolveRedirect: jest.fn().mockRejectedValue(new Error('redirect down')),
    });
    const application = new BilibiliCardApplication(host, createManifest());

    await expect(
      application.handleMessage(
        createMessage({
          messageText: 'https://b23.tv/abc123',
        }),
      ),
    ).resolves.toBe(false);

    expect(host.warn).toHaveBeenCalledWith(
      'Bilibili 短链解析失败: redirect down',
    );
    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });
});

/**
 * Creates the Bilibili card manifest used by package-local application tests.
 * @returns Manifest object with one message event and plugin key metadata.
 */
function createManifest(): BilibiliCardManifest {
  return {
    description: '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
    events: [
      {
        eventName: 'message',
        handlerName: 'handleMessage',
        key: 'bilibili-card.message',
        name: 'Bilibili 卡片解析',
      },
    ],
    name: 'Bilibili Card',
    pluginKey: 'bilibili-card',
    version: '1.0.0',
  };
}

/**
 * Builds a normalized QQBot message with overridable fields for one test case.
 * @param overrides - Message fields that differ from the default group message.
 * @returns Normalized Bilibili card message accepted by the application.
 */
function createMessage(
  overrides: Partial<BilibiliCardMessage> = {},
): BilibiliCardMessage {
  return {
    channelId: undefined,
    messageText: '',
    messageType: 'group',
    rawEvent: {},
    rawMessage: '',
    selfId: '10001',
    targetId: '20001',
    userId: '30001',
    ...overrides,
  };
}

/**
 * Builds the package-local Bilibili host contract used by application tests.
 * @param overrides - Test doubles for host methods involved in a scenario.
 * @returns Host object with harmless defaults for unused plugin capabilities.
 */
function createHost(
  overrides: Partial<BilibiliCardPluginHost> = {},
): BilibiliCardPluginHost {
  return {
    getBoundEventPluginKeys: jest.fn().mockResolvedValue([]),
    getConfig: jest.fn(),
    requestJson: jest.fn(),
    resolveRedirect: jest.fn(),
    sendText: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn(),
    ...overrides,
  };
}

/**
 * Creates a successful Bilibili view API response fixture.
 * @returns Minimal API payload consumed by `BilibiliVideoClient`.
 */
function createBilibiliViewResponse() {
  return {
    code: 0,
    data: {
      aid: 170001,
      bvid: 'BV1xx411c7mD',
      desc: '第一行\n第二行',
      duration: 125,
      owner: { name: 'UP主' },
      pic: 'https://i0.hdslb.com/bfs/archive/demo.jpg',
      stat: {
        danmaku: 456,
        like: 7890,
        view: 123456,
      },
      title: '夏祭',
    },
  };
}
