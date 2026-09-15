import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchTmdbTvSeasonFacts,
  parseTmdbTvSeasonFactsHtml,
  parseTmdbSearchHtml,
  searchTmdbMediaCandidates,
  verifyTmdbMediaCandidate,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-provider-search';

describe('TMDB provider search', () => {
  beforeEach(() => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected TMDB request'));
  });
  afterEach(() => jest.restoreAllMocks());

  const jackalSeasons = readFileSync(
    join(__dirname, 'fixtures/tmdb-jackal-seasons.html'),
    'utf8',
  );

  it('reads the captured Jackal cards through the official slug redirect', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        tmdbResponse(
          jackalSeasons,
          'https://www.themoviedb.org/tv/222766-the-day-of-the-jackal/seasons?language=zh-CN',
        ),
      );
    await expect(fetchTmdbTvSeasonFacts('222766')).resolves.toEqual([
      {
        episodeCount: 10,
        episodeStart: 1,
        releaseYear: 2024,
        seasonNumber: 1,
        title: '第 1 季',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['bare ID', '/tv/222766'],
    ['canonical slug', '/tv/222766-the-day-of-the-jackal'],
    ['encoded title', '/tv/222766-%E8%B1%BA%E7%8B%BC'],
  ])(
    'reads %s links, sorted seasons, specials and zero-episode future seasons',
    (_label, base) => {
      const seasons = [
        `<div class="season"><a href="${base}/season/2">Season 2</a><h4>2025 • 8 Episodes</h4></div>`,
        `<div class="season"><a href="${base}/season/0">Specials</a><h4>2024 • 1 Episode</h4></div>`,
        `<div class="season"><a href="${base}/season/3">Season 3</a><h4>0 Episodes</h4></div>`,
        `<div class="season"><a href="${base}/season/1?language=zh-CN">Cover</a><h2><a href="${base}/season/1">Title</a></h2><h4>2024 • 共 10 集</h4></div>`,
      ].join('\n');
      expect(parseTmdbTvSeasonFactsHtml(seasons, '222766')).toEqual([
        {
          episodeCount: 1,
          episodeStart: 1,
          releaseYear: 2024,
          seasonNumber: 0,
          title: '特别篇',
        },
        {
          episodeCount: 10,
          episodeStart: 1,
          releaseYear: 2024,
          seasonNumber: 1,
          title: '第 1 季',
        },
        {
          episodeCount: 8,
          episodeStart: 1,
          releaseYear: 2025,
          seasonNumber: 2,
          title: '第 2 季',
        },
      ]);
    },
  );

  it.each([
    ['neighbouring ID', 'https://www.themoviedb.org/tv/2227660-jackal/seasons'],
    ['other work', 'https://www.themoviedb.org/tv/222767-jackal/seasons'],
    [
      'wrong namespace',
      'https://www.themoviedb.org/movie/222766-jackal/seasons',
    ],
    ['wrong route', 'https://www.themoviedb.org/tv/222766-jackal/season/1'],
    [
      'route prefix collision',
      'https://www.themoviedb.org/tv/222766/seasons/edit',
    ],
    ['external origin', 'https://example.com/tv/222766/seasons'],
    ['HTTP downgrade', 'http://www.themoviedb.org/tv/222766/seasons'],
    ['unexpected port', 'https://www.themoviedb.org:8443/tv/222766/seasons'],
  ])('rejects %s redirects without trusting the HTML', async (_label, url) => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => tmdbResponse(jackalSeasons, url));
    await expect(fetchTmdbTvSeasonFacts('222766')).rejects.toThrow(
      'tmdb-provider-search-unavailable',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an identity whose numeric ID merely starts with the requested ID', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () =>
        tmdbResponse(
          '<title>Another show (2024)</title>',
          'https://www.themoviedb.org/tv/2227660-other-show',
        ),
      );
    await expect(
      verifyTmdbMediaCandidate({
        mediaType: 'tv',
        providerId: '222766',
        releaseYear: 2024,
      }),
    ).rejects.toThrow('tmdb-provider-search-unavailable');
  });

  it.each(['100', '1000'])(
    'rejects out-of-range season %s instead of ignoring it',
    (season) => {
      const invalid = jackalSeasons.replaceAll(
        '/season/1',
        `/season/${season}`,
      );
      expect(() => parseTmdbTvSeasonFactsHtml(invalid, '222766')).toThrow(
        'tmdb-provider-season-number-invalid',
      );
    },
  );

  it.each(['2001', '10000'])(
    'rejects out-of-range episode count %s',
    (count) => {
      expect(() =>
        parseTmdbTvSeasonFactsHtml(
          jackalSeasons.replace('共 10 集', `共 ${count} 集`),
          '222766',
        ),
      ).toThrow('tmdb-provider-season-episode-count-invalid');
    },
  );

  it('does not borrow a synopsis or another season count when the current summary is incomplete', () => {
    const incomplete = `<div class="season card"><a href="/tv/222766/season/0">Specials</a><h4>2024</h4><p>本季共 99 集</p></div>${jackalSeasons}`;
    expect(() => parseTmdbTvSeasonFactsHtml(incomplete, '222766')).toThrow(
      'tmdb-provider-season-episode-count-missing',
    );
  });

  it('rejects conflicting duplicate season cards', () => {
    expect(() =>
      parseTmdbTvSeasonFactsHtml(
        jackalSeasons + jackalSeasons.replace('共 10 集', '共 11 集'),
        '222766',
      ),
    ).toThrow('tmdb-provider-season-facts-conflict');
  });

  it.each([
    ['empty page', '<html></html>'],
    ['future-only', jackalSeasons.replace('共 10 集', '共 0 集')],
    ['different identity', jackalSeasons.replaceAll('222766', '222767')],
  ])('rejects %s without creating a TV shell', async (_label, body) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        tmdbResponse(body, 'https://www.themoviedb.org/tv/222766/seasons'),
      );
    await expect(fetchTmdbTvSeasonFacts('222766')).rejects.toThrow(
      'tmdb-provider-season-facts-missing',
    );
  });

  const html = `
    <div class="comp:media-card">
      <a href="/tv/105473?language=zh-CN">
        <img alt="刀使巫女 刻印一闪的灯火" src="https://media.themoviedb.org/t/p/w94/test.jpg" />
      </a>
      <h2>
        <span>刀使巫女 刻印一闪的灯火</span>
        <span class="font-light"> (刀使ノ巫女 刻みし一閃の燈火)</span>
      </h2>
      <span class="release_date w-full">2020年10月25日</span>
    </div>
    <a href="/tv/105473?language=zh-CN"><span>重复链接</span></a>
  `;

  it('projects stable TMDB identities from bounded public search HTML', () => {
    expect(parseTmdbSearchHtml(html, 'tv')).toEqual([
      {
        candidateId: 'tmdb:105473',
        originalTitle: '刀使ノ巫女 刻みし一閃の燈火',
        posterUrl: 'https://media.themoviedb.org/t/p/w94/test.jpg',
        provider: 'tmdb',
        providerId: '105473',
        releaseYear: 2020,
        title: '刀使巫女 刻印一闪的灯火',
      },
    ]);
  });

  it('uses only the fixed TMDB origin and returns a bounded candidate list', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        tmdbResponse(
          html,
          'https://www.themoviedb.org/search/tv?language=zh-CN&query=test',
        ),
      );

    await expect(
      searchTmdbMediaCandidates({
        mediaType: 'tv',
        releaseYear: 2020,
        title: '刀使巫女 刻印一闪的灯火 OVA',
      }),
    ).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0].toString()).toMatch(
      /^https:\/\/www\.themoviedb\.org\/search\/tv\?/u,
    );
    fetchMock.mockRestore();
  });

  it('reopens a failed pooled connection and verifies an explicit official detail page', async () => {
    const detailHtml = `
      <html>
        <head><meta property="og:title" content="随风而逝 (1999)" /></head>
        <body><span class="release">1999年9月6日</span></body>
      </html>
    `;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        tmdbResponse(detailHtml, 'https://www.themoviedb.org/movie/12345'),
      );

    await expect(
      verifyTmdbMediaCandidate({
        mediaType: 'movie',
        providerId: '12345',
        releaseYear: 1999,
      }),
    ).resolves.toMatchObject({
      providerId: '12345',
      releaseYear: 1999,
      title: '随风而逝 (1999)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('reads the current TMDB release_date and original-name facts for TV 105248', async () => {
    const detailHtml = `
      <html>
        <head>
          <meta property="og:title" content="赛博朋克：边缘行者" />
          <title>赛博朋克：边缘行者 (TV Series 2022) &#8212; The Movie Database (TMDB)</title>
        </head>
        <body>
          <span class="tag release_date">(2022)</span>
          <p class="wrap"><strong>原始片名</strong> サイバーパンク: エッジランナーズ</p>
        </body>
      </html>
    `;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        tmdbResponse(detailHtml, 'https://www.themoviedb.org/tv/105248'),
      );

    await expect(
      verifyTmdbMediaCandidate({
        mediaType: 'tv',
        providerId: '105248',
        releaseYear: 2022,
      }),
    ).resolves.toEqual({
      candidateId: 'tmdb:105248',
      originalTitle: 'サイバーパンク: エッジランナーズ',
      posterUrl: null,
      provider: 'tmdb',
      providerId: '105248',
      releaseYear: 2022,
      title: '赛博朋克：边缘行者',
    });
    fetchMock.mockRestore();
  });

  it('projects the official TMDB season list into continuous TV facts', () => {
    const seasonsHtml = `
      <section class="panel">
        <div class="season">
          <a href="/tv/105248/season/1?language=zh-CN">封面</a>
          <div class="content">
            <h2><a href="/tv/105248/season/1?language=zh-CN">赛博朋克：边缘行者</a></h2>
            <h4>2022 • 共 10 集</h4>
          </div>
        </div>
      </section>
    `;

    expect(parseTmdbTvSeasonFactsHtml(seasonsHtml, '105248')).toEqual([
      {
        episodeCount: 10,
        episodeStart: 1,
        releaseYear: 2022,
        seasonNumber: 1,
        title: '第 1 季',
      },
    ]);
  });

  it('rejects a partial TMDB season card instead of creating a TV shell', () => {
    const partialHtml = `
      <div class="season">
        <a href="/tv/105248/season/1?language=zh-CN">第 1 季</a>
        <h4>2022</h4>
      </div>
    `;

    expect(() => parseTmdbTvSeasonFactsHtml(partialHtml, '105248')).toThrow(
      'tmdb-provider-season-episode-count-missing',
    );
  });
});

/**
 * 创建带最终 TMDB URL 的 HTML Response，模拟 follow 重定向后的浏览器响应。
 * @param body - 响应 HTML。
 * @param url - TMDB 最终地址。
 * @returns 可供 provider 集成测试消费的响应。
 */
function tmdbResponse(body: string, url: string) {
  const response = new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 200,
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}
