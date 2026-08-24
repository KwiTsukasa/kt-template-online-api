import { toBotPluginMessageEvent } from '../../../../src/modules/bot-adapter/core/application/event/plugin-event.mapper';
import type { BotNormalizedMessage } from '../../../../src/modules/bot-adapter/core/contract/bot.types';
import { extractBilibiliUrls } from '../../../../src/modules/plugins/bilibili-card/src/domain/bilibili-url-extractor';

describe('Bot plugin event mapper', () => {
  it('extracts a Bilibili jump URL from a OneBot JSON mini-app segment', () => {
    const qqdocurl =
      'https://b23.tv/vyg1fa3?share_medium=android&share_source=qq';
    const card = JSON.stringify(
      {
        app: 'com.tencent.miniapp_01',
        meta: {
          detail_1: {
            preview: 'https://qq.ugcimg.cn/preview',
            qqdocurl,
            title: 'Bilibili 视频卡片',
          },
        },
        prompt: '[QQ小程序] Bilibili 视频卡片',
      },
    ).replaceAll('/', '\\/');
    const message = {
      eventTime: new Date('2026-08-24T15:54:05.000Z'),
      groupId: '939053394',
      messageId: '384897121',
      messageText: '[CQ:json,data={...}]',
      messageType: 'group',
      rawEvent: {
        message: [{ data: { data: card }, type: 'json' }],
      },
      rawMessage: '[CQ:json,data={...}]',
      selfId: '1914728559',
      targetId: '939053394',
      userId: '2354598417',
    } as BotNormalizedMessage;

    const mapped = toBotPluginMessageEvent(message);
    expect(mapped.links).toEqual([
      'https://qq.ugcimg.cn/preview',
      qqdocurl,
    ]);
    expect(
      extractBilibiliUrls({
        links: mapped.links,
        messageText: mapped.text,
        rawMessage: mapped.rawText,
      }),
    ).toEqual([qqdocurl]);
  });

  it('ignores malformed and oversized embedded JSON without losing direct links', () => {
    const message = {
      eventTime: new Date(),
      groupId: '939053394',
      messageId: 'mapper-boundary',
      messageText: 'https://www.bilibili.com/video/BV17x411w7KC',
      messageType: 'group',
      rawEvent: {
        malformed: '{not-json',
        oversized: JSON.stringify({ value: 'x'.repeat(70 * 1024) }),
      },
      rawMessage: '',
      selfId: '1914728559',
      targetId: '939053394',
      userId: '2354598417',
    } as BotNormalizedMessage;

    expect(toBotPluginMessageEvent(message).links).toEqual([
      'https://www.bilibili.com/video/BV17x411w7KC',
    ]);
  });
});
