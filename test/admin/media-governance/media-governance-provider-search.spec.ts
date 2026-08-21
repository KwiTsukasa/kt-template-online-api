import {
  parseTmdbSearchHtml,
  searchTmdbMediaCandidates,
  verifyTmdbMediaCandidate,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-provider-search';

describe('TMDB provider search', () => {
  const html = `
    <div class="comp:media-card">
      <a href="/tv/105473?language=zh-CN">
        <img alt="刀使巫女 刻印一闪的灯火" src="https://media.themoviedb.org/t/p/w94/test.jpg" />
      </a>
      <span class="release_date w-full">2020年10月25日</span>
    </div>
    <a href="/tv/105473?language=zh-CN"><span>重复链接</span></a>
  `;

  it('projects stable TMDB identities from bounded public search HTML', () => {
    expect(parseTmdbSearchHtml(html, 'tv')).toEqual([
      {
        candidateId: 'tmdb:105473',
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
