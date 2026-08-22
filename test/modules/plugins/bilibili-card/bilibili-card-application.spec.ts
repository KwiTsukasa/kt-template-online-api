import type { BotPluginMessageEvent } from '@/modules/plugin-platform/contract/plugin-protocol';
import { BilibiliCardApplication } from '@/modules/plugins/bilibili-card/src/application/bilibili-card-application';
import type { BilibiliCardPluginHost } from '@/modules/plugins/bilibili-card/src/domain/bilibili-card.types';

describe('Bilibili card protocol plugin', () => {
  const host: BilibiliCardPluginHost = {
    getConfig: jest.fn(() => undefined),
    requestJson: jest.fn(async () => ({
      code: 0,
      data: {
        aid: 170001,
        bvid: 'BV17x411w7KC',
        desc: 'demo',
        duration: 90,
        owner: { name: 'UP' },
        pic: 'https://i.example/cover.jpg',
        stat: { danmaku: 2, like: 3, view: 4 },
        title: 'Demo Video',
      },
    })) as unknown as BilibiliCardPluginHost['requestJson'],
    resolveRedirect: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a reply intent without calling any Bot adapter send API', async () => {
    const application = new BilibiliCardApplication(host, () => 1000);
    await expect(application.handleMessage(createEvent())).resolves.toEqual({
      handled: true,
      replies: [
        expect.objectContaining({
          content: expect.stringContaining('Demo Video'),
          kind: 'text',
        }),
      ],
    });
  });

  it('deduplicates the same video inside one opaque conversation', async () => {
    const application = new BilibiliCardApplication(host, () => 1000);
    await application.handleMessage(createEvent());
    await expect(application.handleMessage(createEvent())).resolves.toEqual({
      handled: false,
      replies: [],
    });
    expect(host.requestJson).toHaveBeenCalledTimes(1);
  });

  it('ignores adapter self messages before resolving links', async () => {
    const application = new BilibiliCardApplication(host);
    await expect(
      application.handleMessage(createEvent({ isSelf: true })),
    ).resolves.toEqual({ handled: false, replies: [] });
    expect(host.requestJson).not.toHaveBeenCalled();
  });
});

/**
 * 构造平台无关的 Bilibili 消息事件。
 * @param patch - 需要覆盖的事件字段。
 * @returns 可直接交给协议插件的事件。
 */
function createEvent(
  patch: Partial<BotPluginMessageEvent> = {},
): BotPluginMessageEvent {
  return {
    conversationKey: 'conversation-1',
    eventId: 'event-1',
    isSelf: false,
    links: ['https://www.bilibili.com/video/BV17x411w7KC'],
    metadata: {},
    rawText: 'https://www.bilibili.com/video/BV17x411w7KC',
    scope: 'group',
    senderKey: 'sender-1',
    text: 'https://www.bilibili.com/video/BV17x411w7KC',
    ...patch,
  };
}
