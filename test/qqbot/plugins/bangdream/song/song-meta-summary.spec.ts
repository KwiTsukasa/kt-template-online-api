describe('BangDream song meta rank summary', () => {
  it('matches full meta ranking entries for a single song', async () => {
    jest.resetModules();
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache',
      () => ({
        __esModule: true,
        default: createCatalogFixture(),
      }),
    );

    const { Server } =
      await import('@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model');
    const songModule =
      await import('@/modules/qqbot/plugins/bangdream/src/domain/song/song.model');
    const { Song, getMetaRanking } = songModule;
    const getSongMetaRankSummary = (
      songModule as typeof songModule & {
        getSongMetaRankSummary?: (
          song: InstanceType<typeof Song>,
          withFever: boolean,
          server: typeof Server.cn,
        ) => {
          entries: Array<{ difficulty: number; meta: number; rank: number }>;
          maxMeta: number;
        };
      }
    ).getSongMetaRankSummary;

    const song = new Song(243);
    const fullRanking = getMetaRanking(true, Server.cn);
    expect(typeof getSongMetaRankSummary).toBe('function');
    const summary = getSongMetaRankSummary(song, true, Server.cn);

    expect(summary.maxMeta).toBe(fullRanking[0].meta);
    expect(summary.entries).toEqual(
      fullRanking
        .filter((entry) => entry.songId === 243)
        .map(({ difficulty, meta, rank }) => ({ difficulty, meta, rank })),
    );
  });

  it('caches jacket image decoding within a song instance', async () => {
    const getJacketImageBuffer = jest
      .fn<Promise<Buffer>, [unknown]>()
      .mockResolvedValue(Buffer.from('fake-png'));
    const loadImage = jest.fn(async () => ({
      height: 1,
      width: 1,
    }));

    jest.resetModules();
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache',
      () => ({
        __esModule: true,
        default: createCatalogFixture(),
      }),
    );
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/domain/song/song-resource.repository',
      () => ({
        songResourceRepository: {
          getChart: jest.fn(),
          getDetail: jest.fn(),
          getJacketImageBuffer,
          getJacketImagePath: jest.fn(),
          getSongRip: jest.fn(),
          resolveJacketImageUrl: jest.fn(),
        },
      }),
    );
    jest.doMock('skia-canvas', () => ({
      loadImage,
    }));

    const { Song } =
      await import('@/modules/qqbot/plugins/bangdream/src/domain/song/song.model');

    const song = new Song(243);
    const first = await song.getSongJacketImage();
    const second = await song.getSongJacketImage();

    expect(first).toBe(second);
    expect(getJacketImageBuffer).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });
});

/**
 * 创建 BangDream 插件对象或配置。
 */
function createCatalogFixture() {
  return {
    meta: {
      100: createMeta({ 1: 90, 2: 60 }),
      243: createMeta({ 1: 50, 2: 70 }),
      300: createMeta({ 1: 100, 2: 100 }),
      400: createMeta({ 1: 70, 2: 70 }),
    },
    songs: {
      100: createSong({ id: 100, publishedCn: true }),
      243: createSong({ id: 243, publishedCn: true }),
      300: createSong({ id: 300, publishedCn: false }),
      400: createSong({ id: 400, publishedCn: true }),
    },
  };
}

/**
 * 创建 BangDream 插件对象或配置。
 * @param { id, publishedCn, } - 解构的歌曲测试元数据，用于构造包含 ID 和国服发布时间的 SongMetaSummary 断言样本。
 */
function createSong({ id, publishedCn }: { id: number; publishedCn: boolean }) {
  return {
    bandId: 1,
    bpm: {
      1: [{ bpm: 120, end: 1, start: 0 }],
      2: [{ bpm: 140, end: 1, start: 0 }],
    },
    closedAt: [],
    difficulty: {
      1: { playLevel: 20 },
      2: { playLevel: 25 },
    },
    jacketImage: [`song-${id}`],
    length: 120,
    musicTitle: [`Song ${id}`, null, null, `歌曲 ${id}`, null],
    nickname: null,
    notes: {
      1: 500,
      2: 700,
    },
    publishedAt: [null, null, null, publishedCn ? 1 : null, null],
    tag: 'normal',
  };
}

/**
 * 创建 BangDream 插件对象或配置。
 * @param values - 配置值字典；驱动 `Object.fromEntries()` 的 BangDream步骤。
 */
function createMeta(values: Record<number, number>) {
  return Object.fromEntries(
    Object.entries(values).map(([difficulty, value]) => [
      difficulty,
      {
        7: [0, value, 0, value],
      },
    ]),
  );
}
