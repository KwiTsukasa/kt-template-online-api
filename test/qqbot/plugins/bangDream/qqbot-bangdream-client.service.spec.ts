import { QqbotBangDreamClientService } from '@/qqbot/plugins/bangDream/qqbot-bangdream-client.service';

describe('QqbotBangDreamClientService', () => {
  let fetchSpy: jest.SpyInstance;
  let service: QqbotBangDreamClientService;

  beforeEach(() => {
    service = new QqbotBangDreamClientService();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = `${url}`;
      if (target.endsWith('/songs/all.1.json')) {
        return jsonResponse({
          '180': {
            musicTitle: ['Returns', 'Returns', 'Returns', 'Returns', 'Returns'],
          },
        });
      }
      if (target.endsWith('/songs/180.json')) {
        return jsonResponse({
          bandId: 1,
          bpm: {
            '3': [{ bpm: 185 }],
          },
          difficulty: {
            '0': { playLevel: 7 },
            '1': { playLevel: 14 },
            '2': { playLevel: 19 },
            '3': { playLevel: 25 },
          },
          length: 132.36,
          musicTitle: ['Returns', 'Returns', 'Returns', 'Returns', 'Returns'],
          notes: {
            '0': 140,
            '1': 269,
            '2': 473,
            '3': 698,
          },
          publishedAt: [
            '1553234400000',
            '1584864000000',
            '1563519600000',
            '1577854800000',
            '1553234400000',
          ],
          tag: 'normal',
        });
      }
      if (target.endsWith('/bands/all.1.json')) {
        return jsonResponse({
          '1': {
            bandName: [
              "Poppin'Party",
              "Poppin'Party",
              "Poppin'Party",
              "Poppin'Party",
              "Poppin'Party",
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('searches Bestdori song by title and builds localized QQ reply text', async () => {
    const result = await service.searchSong({ text: 'Returns' });

    expect(result).toMatchObject({
      bandName: "Poppin'Party",
      bpmText: '185',
      difficultyText: 'EASY7 / NORMAL14 / HARD19 / EXPERT25',
      id: 180,
      lengthText: '2:12',
      notesText: 'EASY140 / NORMAL269 / HARD473 / EXPERT698',
      tagText: '原创',
      title: 'Returns',
      url: 'https://bestdori.com/info/songs/180',
    });
    expect(result.replyText).toContain('BangDream 歌曲：Returns');
    expect(result.replyText).toContain('乐队：Poppin');
    expect(result.replyText).toContain('难度：EASY7 / NORMAL14');
  });

  it('searches Bestdori song by numeric id', async () => {
    const result = await service.searchSong({ text: '180' });

    expect(result.id).toBe(180);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bestdori.com/api/songs/180.json',
      expect.any(Object),
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status,
    }),
  );
}
