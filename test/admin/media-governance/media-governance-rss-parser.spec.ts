import {
  mediaGovernanceMagnetInfoHash,
  mediaGovernanceRssTitleIncluded,
  normalizeMediaGovernanceMagnetUri,
  parseMediaGovernanceEpisodeNumber,
  parseMediaGovernanceRss,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-rss-parser';

describe('media governance RSS parser', () => {
  it('parses LoliHouse episode magnets without treating year or resolution as episode', () => {
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>LoliHouse</title>
          <item>
            <guid>bleach-27</guid>
            <title>[BeanSub&amp;LoliHouse] BLEACH Sennen Kessen-hen - 27 [WebRip 1080p HEVC-10bit]</title>
            <link>magnet:?xt=urn:btih:d9470856384840edd9b61478c8352095b2c3e885</link>
            <pubDate>Sun, 15 Oct 2024 15:32:00 GMT</pubDate>
          </item>
          <item>
            <guid>bleach-40</guid>
            <title>[BeanSub&amp;LoliHouse] BLEACH Sennen Kessen-hen - 40 [WebRip 1080p]</title>
            <magnetURI>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</magnetURI>
          </item>
        </channel>
      </rss>`;

    const entries = parseMediaGovernanceRss(feed);

    expect(entries).toHaveLength(2);
    expect(parseMediaGovernanceEpisodeNumber(entries[0].title, null)).toBe(27);
    expect(parseMediaGovernanceEpisodeNumber(entries[1].title, null)).toBe(40);
    expect(mediaGovernanceMagnetInfoHash(entries[0].magnetUri!)).toBe(
      'd9470856384840edd9b61478c8352095b2c3e885',
    );
    expect(entries[0].publishedAt?.toISOString()).toBe(
      '2024-10-15T15:32:00.000Z',
    );
    expect(entries[0].torrentUrl).toBeNull();
  });

  it('supports named episode groups and optional title inclusion filters', () => {
    const title = '[LoliHouse] BLEACH TYBW #0031 1080p';

    expect(
      parseMediaGovernanceEpisodeNumber(title, '#(?<episode>\\d{4})(?:\\s|$)'),
    ).toBe(31);
    expect(mediaGovernanceRssTitleIncluded(title, 'LoliHouse')).toBe(true);
    expect(mediaGovernanceRssTitleIncluded(title, 'DBD-Raws')).toBe(false);
  });

  it('parses absolute episodes from compact season-episode release names', () => {
    const titles = [41, 42, 43, 44, 45].map(
      (episode) =>
        `[Nix-Raws] BLEACH Sennen Kessen-hen Kashin-tan S01E${episode} [WEB-DL 1080p]`,
    );

    expect(
      titles.map((title) => parseMediaGovernanceEpisodeNumber(title, null)),
    ).toEqual([41, 42, 43, 44, 45]);
  });

  it('parses standalone bracket episodes without treating years or resolution as episodes', () => {
    const titles = Array.from({ length: 10 }, (_item, index) => {
      const episode = String(index + 1).padStart(2, '0');
      return `[猎户不鸽发布组] 赛博朋克：边缘行者 / Cyberpunk Edgerunners [${episode}] [1080p] [网飞2022年9月番]`;
    });

    expect(
      titles.map((title) => parseMediaGovernanceEpisodeNumber(title, null)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(
      parseMediaGovernanceEpisodeNumber(
        '[Archive] Cyberpunk Edgerunners [2022] [1080]',
        null,
      ),
    ).toBeNull();
    expect(
      parseMediaGovernanceEpisodeNumber(
        '[DBD-Raws] Cyberpunk Edgerunners [01-10TV全集] [1080P]',
        null,
      ),
    ).toBeNull();
  });

  it('rejects XML entity declarations before parsing', () => {
    expect(() =>
      parseMediaGovernanceRss(
        '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>',
      ),
    ).toThrow('media-rss-feed-boundary-invalid');
  });

  it('normalizes Base32 BTIH and exposes HTTPS torrent enclosures', () => {
    const base32 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const normalized = normalizeMediaGovernanceMagnetUri(
      `magnet:?xt=urn:btih:${base32}&tr=https%3A%2F%2Ftracker.example%2Fannounce`,
    );
    expect(normalized).toBe(
      'magnet:?xt=urn:btih:0000000000000000000000000000000000000000&tr=https%3A%2F%2Ftracker.example%2Fannounce',
    );
    const entries = parseMediaGovernanceRss(`
      <rss><channel><item>
        <title>[LoliHouse] BLEACH - 27</title>
        <guid>acg-27</guid>
        <enclosure url="https://acg.rip/t/27.torrent" type="application/x-bittorrent" />
      </item></channel></rss>
    `);
    expect(entries[0]).toMatchObject({
      magnetUri: null,
      torrentUrl: 'https://acg.rip/t/27.torrent',
    });
  });
});
