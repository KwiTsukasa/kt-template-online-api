import {
  discoverMediaGovernanceRssSources,
  searchMediaGovernanceRssIdentityCandidates,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-rss-discovery';

describe('media governance RSS discovery', () => {
  it('returns explicit Bangumi and TMDB identity candidates before source discovery', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        data: [
          {
            date: '2022-10-11',
            eps: 13,
            id: 302286,
            images: { grid: 'https://lain.bgm.tv/r/100/test.jpg' },
            name: 'BLEACH 千年血戦篇',
            name_cn: '死神 千年血战篇',
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await searchMediaGovernanceRssIdentityCandidates('死神', {
      fetchImpl,
      searchTmdb: async () => [
        {
          candidateId: 'tmdb:30984',
          posterUrl: null,
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
          title: '死神',
        },
      ],
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'bangumi:302286',
          provider: 'bangumi',
          title: '死神 千年血战篇',
        }),
        expect.objectContaining({
          candidateId: 'tmdb:30984',
          provider: 'tmdb',
          title: '死神',
        }),
      ]),
    );
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'bangumi', status: 'available' }),
        expect.objectContaining({ provider: 'tmdb', status: 'available' }),
      ]),
    );
  });

  it('isolates one identity provider failure instead of discarding valid candidates', async () => {
    const result = await searchMediaGovernanceRssIdentityCandidates('BLEACH', {
      fetchImpl: (async () => {
        throw new Error('bangumi unavailable');
      }) as typeof fetch,
      searchTmdb: async () => [
        {
          candidateId: 'tmdb:30984',
          posterUrl: null,
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
          title: 'BLEACH',
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.providers).toContainEqual(
      expect.objectContaining({
        errorCode: 'bangumi-identity-unavailable',
        provider: 'bangumi',
        status: 'unavailable',
      }),
    );
  });

  it('deduplicates BTIH across sources and groups results by release group', async () => {
    const hash = '0123456789abcdef0123456789abcdef01234567';
    const secondHash = '89abcdef0123456789abcdef0123456789abcdef';
    const thirdHash = 'fedcba9876543210fedcba9876543210fedcba98';
    const fourthHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fetchImpl = jest.fn(async (input) => {
      const url = String(input);
      if (url === 'https://api.bgm.tv/v0/subjects/302286') {
        return jsonResponse({
          date: '2022-10-11',
          eps: 13,
          id: 302286,
          images: { grid: 'https://lain.bgm.tv/r/100/test.jpg' },
          name: 'BLEACH TYBW',
          name_cn: '死神 千年血战篇-诀别谭-',
          type: 2,
        });
      }
      if (url.startsWith('https://mikanani.kas.pub/Home/Search')) {
        return textResponse(`
          <a href="/Home/Bangumi/2841"><img title="死神 千年血战篇-诀别谭-" /></a>
          <table><tbody><tr>
            <td>2026/08/23 12:00</td>
            <td><a href="/Home/Episode/${hash}">[LoliHouse] BLEACH TYBW - 01 [1080p]</a></td>
            <td><a href="/Download/20260823/${hash}.torrent">torrent</a></td>
            <td><a data-clipboard-text="magnet:?xt=urn:btih:${hash}">magnet</a></td>
          </tr></tbody></table>
        `);
      }
      if (url === 'https://mikanani.kas.pub/Home/Bangumi/2841') {
        return textResponse(`
          <div class="subgroup-text" id="370">
            <a href="/Home/PublishGroup/223">LoliHouse</a>
            <a href="/RSS/Bangumi?bangumiId=2841&subgroupid=370">RSS</a>
          </div><div class="subgroup-scroll-end-370"></div>
          <div class="subgroup-text" id="12">
            <a href="/Home/PublishGroup/12">悠哈璃羽字幕社</a>
            <a href="/RSS/Bangumi?bangumiId=2841&subgroupid=12">RSS</a>
          </div><div class="subgroup-scroll-end-12"></div>
        `);
      }
      if (
        url ===
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=2841&subgroupid=370'
      ) {
        return xmlResponse(
          rssItem({
            enclosure: `magnet:?xt=urn:btih:${hash}`,
            link: 'https://mikanani.kas.pub/Home/Episode/1',
            title: '[LoliHouse] BLEACH TYBW - 01 [1080p]',
          }),
        );
      }
      if (
        url ===
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=2841&subgroupid=12'
      ) {
        return xmlResponse(
          rssItem({
            enclosure: `magnet:?xt=urn:btih:${fourthHash}`,
            link: 'https://mikanani.kas.pub/Home/Episode/4',
            title: '[UHA-WINGS] BLEACH TYBW - 04 [1080p]',
          }),
        );
      }
      if (url === 'https://bangumi.moe/api/v2/torrent/search') {
        return jsonResponse({
          torrents: [
            {
              infoHash: hash,
              magnet: `magnet:?xt=urn:btih:${hash}`,
              publish_time: '2026-08-23T12:00:00.000Z',
              seeders: 8,
              size: '800 MiB',
              team: { name: 'LoliHouse' },
              title: '[LoliHouse] BLEACH TYBW - 01 [1080p]',
            },
          ],
        });
      }
      if (url.startsWith('https://nyaa.si/')) {
        return xmlResponse(
          rssItem({
            extra: `<nyaa:infoHash>${hash}</nyaa:infoHash><nyaa:seeders>12</nyaa:seeders>`,
            link: `https://nyaa.si/download/1.torrent`,
            title: '[LoliHouse] BLEACH TYBW - 01 [1080p]',
          }) +
            rssItem({
              extra: `<nyaa:infoHash>${thirdHash}</nyaa:infoHash><nyaa:seeders>3</nyaa:seeders>`,
              link: `https://nyaa.si/download/3.torrent`,
              title: 'BLEACH TYBW - S01E03 [English Dub][1080p]',
            }),
          'xmlns:nyaa="https://nyaa.si/xmlns/nyaa"',
        );
      }
      if (url.startsWith('https://acg.rip/.xml')) {
        const term = new URL(url).searchParams.get('term');
        if (term === '死神 千年血战篇-诀别谭-') {
          return textResponse('upstream rejected long query', 500);
        }
        if (term !== '诀别谭') throw new Error(`unexpected ACG term ${term}`);
        return xmlResponse(
          rssItem({
            enclosure: 'https://acg.rip/t/1.torrent',
            link: 'https://acg.rip/t/1',
            title: '[LoliHouse] BLEACH TYBW - 01 [1080p]',
          }),
        );
      }
      if (url.startsWith('https://share.dmhy.org/')) {
        const keyword = new URL(url).searchParams.get('keyword');
        if (keyword === '死神 千年血战篇-诀别谭-') {
          return textResponse('upstream rejected long query', 500);
        }
        if (keyword !== '诀别谭') {
          throw new Error(`unexpected DMHY keyword ${keyword}`);
        }
        return xmlResponse(
          rssItem({
            author: 'LoliHouse',
            enclosure: `magnet:?xt=urn:btih:${secondHash}`,
            link: 'https://share.dmhy.org/topics/view/2',
            title: '[LoliHouse] BLEACH TYBW - 02 [1080p]',
          }),
        );
      }
      if (url.startsWith('https://anibt.net/')) {
        return xmlResponse(
          rssItem({
            extra: `<torrent><groupName>LoliHouse</groupName><infohash>${secondHash}</infohash><magneturi>magnet:?xt=urn:btih:${secondHash}</magneturi><fileSize>900000000</fileSize></torrent>`,
            link: 'https://anibt.net/release/2',
            title: '[LoliHouse] BLEACH TYBW - 02 [1080p]',
          }),
        );
      }
      if (url.startsWith('https://www.shanaproject.com/')) {
        return textResponse('unavailable', 503);
      }
      if (url.startsWith('https://nekobt.to/')) {
        return xmlResponse(
          rssItem({
            enclosure: `magnet:?xt=urn:btih:${hash}`,
            extra: `<torznab:attr name="infohash" value="${hash}"/><torznab:attr name="seeders" value="20"/>`,
            link: `magnet:?xt=urn:btih:${hash}`,
            title: '[LoliHouse] BLEACH TYBW - 01 [1080p]',
          }),
          'xmlns:torznab="http://torznab.com/schemas/2015/feed"',
        );
      }
      if (url.startsWith('https://subsplease.org/')) {
        return jsonResponse({
          bleach: {
            downloads: [{ magnet: `magnet:?xt=urn:btih:${hash}`, res: '1080' }],
            episode: '01',
            page: 'bleach',
            release_date: '2026-08-23T12:00:00.000Z',
            show: 'BLEACH TYBW',
          },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const result = await discoverMediaGovernanceRssSources(
      {
        identity: {
          provider: 'bangumi',
          providerId: '302286',
          releaseYear: 2022,
        },
        originalTitle: 'BLEACH',
        releaseYear: 2004,
        seasonNumber: 2,
        seriesTitle: '死神',
      },
      { fetchImpl },
    );

    const loliHouse = result.groups.find(
      (group) => group.releaseGroup === 'LoliHouse',
    );
    expect(loliHouse).toBeDefined();
    expect(loliHouse?.uniqueItemCount).toBe(2);
    expect(loliHouse?.providers).toEqual(
      expect.arrayContaining([
        'acg-rip',
        'anibt',
        'bangumi-moe',
        'dmhy',
        'mikan',
        'nekobt',
        'nyaa',
      ]),
    );
    expect(loliHouse?.subscriptionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'mikan' }),
        expect.objectContaining({ provider: 'nyaa' }),
        expect.objectContaining({ provider: 'acg-rip' }),
        expect.objectContaining({ provider: 'dmhy' }),
        expect.objectContaining({ provider: 'anibt' }),
        expect.objectContaining({ provider: 'nekobt' }),
      ]),
    );
    const episodeOne = loliHouse?.items.find((item) => item.infoHash === hash);
    expect(episodeOne?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'bangumi-moe' }),
        expect.objectContaining({ provider: 'nyaa' }),
        expect.objectContaining({ provider: 'acg-rip' }),
      ]),
    );
    expect(result.providers).toContainEqual(
      expect.objectContaining({
        errorCode: 'shana-project-unavailable',
        provider: 'shana-project',
        status: 'unavailable',
      }),
    );
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'acg-rip', status: 'available' }),
        expect.objectContaining({ provider: 'dmhy', status: 'available' }),
      ]),
    );
    expect(
      result.groups.some((group) => group.releaseGroup === '未识别发布组'),
    ).toBe(false);
    expect(result.groups).toContainEqual(
      expect.objectContaining({
        releaseGroup: '悠哈璃羽字幕社',
        subscriptionOptions: [
          expect.objectContaining({
            feedUrl:
              'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=2841&subgroupid=12',
            itemCount: 1,
            provider: 'mikan',
          }),
        ],
        uniqueItemCount: 1,
      }),
    );
  });
});

/**
 * 创建 JSON Response 测试夹具。
 *
 * @param value - 要序列化的响应对象。
 * @param status - HTTP 状态码。
 * @returns 带 JSON Content-Type 的 Response。
 */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

/**
 * 创建 HTML 或普通文本 Response 测试夹具。
 *
 * @param value - 响应正文。
 * @param status - HTTP 状态码。
 * @returns 文本 Response。
 */
function textResponse(value: string, status = 200): Response {
  return new Response(value, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status,
  });
}

/**
 * 把单个 item 片段包装为 RSS 2.0 测试 Feed。
 *
 * @param item - RSS 条目 XML 片段。
 * @param namespace - 可选命名空间声明。
 * @returns 包含 XML 正文的响应对象。
 */
function xmlResponse(item: string, namespace = ''): Response {
  return new Response(
    `<?xml version="1.0"?><rss version="2.0" ${namespace}><channel>${item}</channel></rss>`,
    { headers: { 'content-type': 'application/rss+xml' }, status: 200 },
  );
}

/**
 * 根据字段生成单个 RSS item XML。
 *
 * @param input - 标题、链接、可选 enclosure、作者和扩展节点。
 * @returns RSS 条目 XML 片段。
 */
function rssItem(input: {
  author?: string;
  enclosure?: string;
  extra?: string;
  link: string;
  title: string;
}): string {
  let author = '';
  if (input.author) author = `<author>${input.author}</author>`;
  let enclosure = '';
  if (input.enclosure) {
    enclosure = `<enclosure url="${input.enclosure}" type="application/x-bittorrent"/>`;
  }
  return `<item><title>${input.title}</title><guid>${input.link}</guid><link>${input.link}</link><pubDate>Sun, 23 Aug 2026 12:00:00 GMT</pubDate>${author}${enclosure}${input.extra ?? ''}</item>`;
}
