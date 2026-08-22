import { extractBilibiliUrls } from '@/modules/plugins/bilibili-card/src/domain/bilibili-url-extractor';

describe('Bilibili protocol URL extractor', () => {
  it('combines adapter links and text while preserving first occurrence', () => {
    expect(
      extractBilibiliUrls({
        links: ['https://b23.tv/abc123'],
        messageText: 'also https://www.bilibili.com/video/BV17x411w7KC',
        rawMessage: 'duplicate https://b23.tv/abc123',
      }),
    ).toEqual([
      'https://b23.tv/abc123',
      'https://www.bilibili.com/video/BV17x411w7KC',
    ]);
  });

  it('rejects unrelated domains supplied by an adapter', () => {
    expect(
      extractBilibiliUrls({ links: ['https://example.com/video/1'] }),
    ).toEqual([]);
  });
});
