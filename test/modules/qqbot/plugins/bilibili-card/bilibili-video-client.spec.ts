import { readBilibiliCardRuntimeConfig } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/config/bilibili-card-config';
import type { BilibiliCardPluginHost } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types';
import { formatBilibiliVideoReply } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-reply-formatter';
import { createBilibiliCardGenericHostAdapter } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-card-host';
import { BilibiliVideoClient } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-video-client';

describe('Bilibili video client', () => {
  it('fetches a BV video through the plugin host and normalizes the response', async () => {
    const host = createHost({
      requestJson: jest.fn().mockResolvedValue({
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
      }),
    });
    const client = new BilibiliVideoClient(host);

    await expect(
      client.fetchVideo(
        {
          canonicalVideoId: 'BV1xx411c7mD',
          kind: 'bvid',
          sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
          value: 'BV1xx411c7mD',
        },
        readBilibiliCardRuntimeConfig(host),
      ),
    ).resolves.toMatchObject({
      aid: 170001,
      bvid: 'BV1xx411c7mD',
      duration: 125,
      ownerName: 'UP主',
      title: '夏祭',
    });

    expect(host.requestJson).toHaveBeenCalledTimes(1);
    const request = (host.requestJson as jest.Mock).mock.calls[0][0];
    expect(request.url.toString()).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
    );
    expect(request.timeoutMs).toBe(6000);
    expect(request.context).toBe('Bilibili 视频信息获取');
    expect(request.failureMessage(502)).toBe(
      'Bilibili 视频信息获取失败：HTTP 502',
    );
    expect(request.invalidJsonMessage).toBe(
      'Bilibili 视频信息返回不是合法 JSON',
    );
  });

  it('throws a readable error when Bilibili returns an error code', async () => {
    const host = createHost({
      requestJson: jest.fn().mockResolvedValue({
        code: -404,
        message: '啥都木有',
      }),
    });
    const client = new BilibiliVideoClient(host);

    await expect(
      client.fetchVideo(
        {
          canonicalVideoId: 'av170001',
          kind: 'aid',
          sourceUrl: 'https://m.bilibili.com/video/av170001',
          value: '170001',
        },
        readBilibiliCardRuntimeConfig(host),
      ),
    ).rejects.toThrow('Bilibili 视频信息获取失败：啥都木有');

    const request = (host.requestJson as jest.Mock).mock.calls[0][0];
    expect(request.url.toString()).toBe(
      'https://api.bilibili.com/x/web-interface/view?aid=170001',
    );
  });

  it('formats a concise text reply without echoing short links', () => {
    expect(
      formatBilibiliVideoReply(
        {
          aid: 170001,
          bvid: 'BV1xx411c7mD',
          desc: '第一行\n第二行',
          duration: 125,
          ownerName: 'UP主',
          pic: 'https://i0.hdslb.com/bfs/archive/demo.jpg',
          stat: {
            danmaku: 456,
            like: 7890,
            view: 123456,
          },
          title: '夏祭',
        },
        {
          dedupeTtlMs: 600000,
          descMaxLength: 6,
          httpTimeoutMs: 6000,
          maxRedirects: 5,
        },
      ),
    ).toBe(
      [
        '[CQ:image,file=https://i0.hdslb.com/bfs/archive/demo.jpg]',
        'Bilibili 视频解析',
        '标题：夏祭',
        'UP：UP主',
        '时长：02:05',
        '播放：12.3万 弹幕：456 点赞：7890',
        '链接：https://www.bilibili.com/video/BV1xx411c7mD',
        '简介：第一行 第二…',
      ].join('\n'),
    );
  });

  it('clamps runtime config values from the plugin host', () => {
    const host = createHost({
      /**
       * Reads test config values by Bilibili card runtime key.
       * @param key - Runtime config key requested by `readBilibiliCardRuntimeConfig`.
       * @returns String value supplied by the current clamp scenario.
       */
      getConfig: (<T = string>(key: string) => {
        return {
          QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS: '9999999',
          QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH: '-1',
          QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS: '10',
          QQBOT_BILIBILI_CARD_MAX_REDIRECTS: '99',
        }[key] as T | undefined;
      }) as BilibiliCardPluginHost['getConfig'],
    });

    expect(readBilibiliCardRuntimeConfig(host)).toEqual({
      dedupeTtlMs: 3600000,
      descMaxLength: 0,
      httpTimeoutMs: 1000,
      maxRedirects: 10,
    });
  });

  it('emits generic host warnings without surfacing rejected log calls', async () => {
    const host = {
      warn: jest.fn().mockRejectedValue(new Error('log down')),
    };
    const adapter = createBilibiliCardGenericHostAdapter(host, {});

    adapter.warn?.('hello');
    await Promise.resolve();
    await Promise.resolve();

    expect(host.warn).toHaveBeenCalledWith('hello');
  });
});

/**
 * Builds the package-local Bilibili host contract used by client and config tests.
 * @param overrides - Test doubles for host methods involved in the current assertion.
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
