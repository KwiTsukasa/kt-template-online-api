import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
  parseBilibiliVideoReference,
} from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser';

describe('Bilibili URL parser', () => {
  it('parses BV video URLs while ignoring query, hash, and trailing punctuation', () => {
    const reference = parseBilibiliVideoReference(
      'https://www.bilibili.com/video/BV1xx411c7mD/?share_source=qq#reply。',
    );

    expect(reference).toEqual({
      canonicalVideoId: 'BV1xx411c7mD',
      kind: 'bvid',
      sourceUrl:
        'https://www.bilibili.com/video/BV1xx411c7mD/?share_source=qq#reply',
      value: 'BV1xx411c7mD',
    });
  });

  it('parses av video URLs from mobile Bilibili links', () => {
    expect(
      parseBilibiliVideoReference('https://m.bilibili.com/video/av170001'),
    ).toMatchObject({
      canonicalVideoId: 'av170001',
      kind: 'aid',
      value: '170001',
    });
  });

  it('allows only Bilibili and b23.tv hosts', () => {
    expect(isAllowedBilibiliUrl('https://b23.tv/abc123')).toBe(true);
    expect(isAllowedBilibiliUrl('https://space.bilibili.com/1')).toBe(true);
    expect(isAllowedBilibiliUrl('https://example.com/video/BV1xx411c7mD')).toBe(
      false,
    );
  });

  it('cleans card wrappers, html entities, and trailing brackets', () => {
    expect(
      cleanBilibiliUrlCandidate(
        '&quot;https://www.bilibili.com/video/BV1xx411c7mD?p=1&quot;）',
      ),
    ).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=1');
  });
});
