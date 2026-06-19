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

  it('parses b23.tv paths that directly embed BV or av ids', () => {
    expect(parseBilibiliVideoReference('https://b23.tv/BV1xx411c7mD')).toEqual({
      canonicalVideoId: 'BV1xx411c7mD',
      kind: 'bvid',
      sourceUrl: 'https://b23.tv/BV1xx411c7mD',
      value: 'BV1xx411c7mD',
    });
    expect(parseBilibiliVideoReference('https://b23.tv/av170001')).toMatchObject(
      {
        canonicalVideoId: 'av170001',
        kind: 'aid',
        value: '170001',
      },
    );
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

  it('does not parse video ids from query or hash on non-video Bilibili pages', () => {
    expect(
      parseBilibiliVideoReference(
        'https://space.bilibili.com/1?from=/video/BV1xx411c7mD',
      ),
    ).toBeNull();
    expect(
      parseBilibiliVideoReference(
        'https://www.bilibili.com/search?keyword=BV1xx411c7mD',
      ),
    ).toBeNull();
    expect(
      parseBilibiliVideoReference(
        'https://space.bilibili.com/1#/video/BV1xx411c7mD',
      ),
    ).toBeNull();
  });

  it('rejects malformed BV path segments with extra characters', () => {
    expect(
      parseBilibiliVideoReference(
        'https://www.bilibili.com/video/BV1xx411c7mDextra',
      ),
    ).toBeNull();
  });

  it('cleans xml html entities and full-width brackets', () => {
    expect(
      cleanBilibiliUrlCandidate(
        '&lt;【https://www.bilibili.com/video/BV1xx411c7mD】&gt;',
      ),
    ).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });
});
