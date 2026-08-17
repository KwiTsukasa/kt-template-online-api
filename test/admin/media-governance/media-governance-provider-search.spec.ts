import {
  parseTmdbSearchHtml,
  searchTmdbMediaCandidates,
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
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      }),
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
});
