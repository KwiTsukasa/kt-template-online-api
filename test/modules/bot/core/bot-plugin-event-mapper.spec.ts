import { toBotPluginMessageEvent } from '../../../../src/modules/bot-adapter/core/application/event/plugin-event.mapper';
import type { BotNormalizedMessage } from '../../../../src/modules/bot-adapter/core/contract/bot.types';
import { extractBilibiliUrls } from '../../../../src/modules/plugins/bilibili-card/src/domain/bilibili-url-extractor';

const imageMessage = (rawEvent: Record<string, unknown>) =>
  ({
    eventTime: new Date(),
    messageId: 'image-message',
    messageText: '',
    messageType: 'group',
    rawEvent,
    rawMessage: '',
    selfId: 'qq-official:test',
    targetId: 'test-group-openid',
    userId: 'test-user-openid',
  }) as BotNormalizedMessage;

describe('Bot plugin event mapper', () => {
  it('preserves an official image-only message without treating other attachments or previews as images', () => {
    const mapped = toBotPluginMessageEvent(
      imageMessage({
        content: '',
        attachments: [
          {
            content_type: 'image/jpeg',
            url: 'https://multimedia.nt.qq.com.cn/image?key=test',
          },
          {
            content_type: 'application/pdf',
            url: 'https://files.example.test/paper.pdf',
          },
        ],
        preview: 'https://example.test/card-preview.png',
      }),
    );
    expect(mapped.text).toBe('');
    expect(mapped.imageUrls).toEqual([
      'https://multimedia.nt.qq.com.cn/image?key=test',
    ]);
    expect(mapped.links).toContain('https://example.test/card-preview.png');
    expect(mapped.senderKey).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps OneBot image order, normalizes protocol-relative URLs and removes duplicate references', () => {
    const mapped = toBotPluginMessageEvent(
      imageMessage({
        message: [
          { type: 'image', data: { url: '//gchat.qpic.cn/first' } },
          { type: 'image', data: { file: 'https://gchat.qpic.cn/second' } },
          { type: 'image', data: { url: 'https://gchat.qpic.cn/first' } },
          { type: 'text', data: { text: 'https://example.test/ordinary.png' } },
        ],
      }),
    );
    expect(mapped.imageUrls).toEqual([
      'https://gchat.qpic.cn/first',
      'https://gchat.qpic.cn/second',
    ]);
  });

  it('retains unreadable images as unavailable rather than silently turning them into empty messages', () => {
    for (const url of [
      undefined,
      '',
      'file:///private/image.jpg',
      'data:image/png;base64,a',
      'https://user:secret@example.test/image',
    ]) {
      const mapped = toBotPluginMessageEvent(
        imageMessage({
          attachments: [{ content_type: 'image/png', url }],
        }),
      );
      expect(mapped.imageUrls).toEqual(['']);
    }
  });

  it('extracts a Bilibili jump URL from a OneBot JSON mini-app segment', () => {
    const qqdocurl =
      'https://b23.tv/vyg1fa3?share_medium=android&share_source=qq';
    const card = JSON.stringify({
      app: 'com.tencent.miniapp_01',
      meta: {
        detail_1: {
          preview: 'https://qq.ugcimg.cn/preview',
          qqdocurl,
          title: 'Bilibili 视频卡片',
        },
      },
      prompt: '[QQ小程序] Bilibili 视频卡片',
    }).replaceAll('/', '\\/');
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
    expect(mapped.links).toEqual(['https://qq.ugcimg.cn/preview', qqdocurl]);
    expect(mapped.imageUrls).toEqual([]);
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
