import { extractBilibiliUrls } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor';

describe('Bilibili URL extractor', () => {
  it('extracts links from messageText and rawMessage while deduplicating them', () => {
    expect(
      extractBilibiliUrls({
        messageText: '看看 https://www.bilibili.com/video/BV1xx411c7mD',
        rawMessage:
          '重复 https://www.bilibili.com/video/BV1xx411c7mD?share=qq',
        rawEvent: {},
      }),
    ).toEqual([
      'https://www.bilibili.com/video/BV1xx411c7mD',
      'https://www.bilibili.com/video/BV1xx411c7mD?share=qq',
    ]);
  });

  it('extracts a QQ share card URL', () => {
    const urls = extractBilibiliUrls({
      messageText: '',
      rawMessage: '',
      rawEvent: {
        message: [
          {
            data: {
              content: '夏祭 视频',
              title: 'Bilibili',
              url: 'https://www.bilibili.com/video/BV1xx411c7mD',
            },
            type: 'share',
          },
        ],
      },
    });

    expect(urls).toEqual(['https://www.bilibili.com/video/BV1xx411c7mD']);
  });

  it('extracts nested URLs from json and lightapp cards', () => {
    const payload = JSON.stringify({
      app: 'com.tencent.structmsg',
      meta: {
        detail: {
          jumpUrl: 'https://b23.tv/abc123',
        },
      },
    });

    expect(
      extractBilibiliUrls({
        messageText: '',
        rawMessage: '',
        rawEvent: {
          message: [
            { data: { data: payload }, type: 'json' },
            { data: { data: payload }, type: 'lightapp' },
          ],
        },
      }),
    ).toEqual(['https://b23.tv/abc123']);
  });

  it('extracts URLs from xml card text and ignores non-Bilibili URLs', () => {
    expect(
      extractBilibiliUrls({
        messageText: 'https://example.com/video/BV1xx411c7mD',
        rawMessage: '',
        rawEvent: {
          message: [
            {
              data: {
                data: '<msg url="https://m.bilibili.com/video/av170001" />',
              },
              type: 'xml',
            },
          ],
        },
      }),
    ).toEqual(['https://m.bilibili.com/video/av170001']);
  });

  it('stops URL tokens at CQ separators and ASCII punctuation', () => {
    expect(
      extractBilibiliUrls({
        messageText:
          '[CQ:share,url=https://b23.tv/abc123,title=视频] https://www.bilibili.com/video/BV1xx411c7mD.',
        rawEvent: {},
        rawMessage: '',
      }),
    ).toEqual([
      'https://b23.tv/abc123',
      'https://www.bilibili.com/video/BV1xx411c7mD',
    ]);
  });

  it('does not scan unrelated rawEvent string fields', () => {
    expect(
      extractBilibiliUrls({
        messageText: '',
        rawMessage: '',
        rawEvent: {
          debug: 'https://www.bilibili.com/video/BV1xx411c7mD',
          message: [],
        },
      }),
    ).toEqual([]);
  });

  it('keeps exact cleaned URL dedupe while preserving distinct query URLs', () => {
    expect(
      extractBilibiliUrls({
        messageText:
          'https://b23.tv/abc123 https://b23.tv/abc123 https://b23.tv/abc123?share=qq',
        rawEvent: {},
        rawMessage: 'https://b23.tv/abc123',
      }),
    ).toEqual(['https://b23.tv/abc123', 'https://b23.tv/abc123?share=qq']);
  });

  it('handles invalid JSON card strings without aborting extraction', () => {
    expect(
      extractBilibiliUrls({
        messageText: '',
        rawMessage: '',
        rawEvent: {
          message: [
            {
              data: {
                data: '{"jumpUrl":"https://b23.tv/abc123"',
              },
              type: 'json',
            },
          ],
        },
      }),
    ).toEqual(['https://b23.tv/abc123']);
  });
});
