import { assetErrorImageBuffer } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import {
  SongResourceRepository,
  type SongJacketSource,
} from '@/qqbot/plugins/bangDream/tsugu/models/song-resource-repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

function createSongSource(
  overrides: Partial<SongJacketSource> = {},
): SongJacketSource {
  return {
    jacketImage: ['SummerFest'],
    publishedAt: [100, null, null, 200, null],
    songId: 136,
    ...overrides,
  };
}

describe('BangDream song resource repository', () => {
  it('routes song detail and chart requests through the provider', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ ok: true });
    const repository = new SongResourceRepository(provider);

    await expect(repository.getDetail(136)).resolves.toEqual({ ok: true });
    await expect(repository.getChart(136, 3)).resolves.toEqual({ ok: true });

    expect(provider.getJson).toHaveBeenNthCalledWith(1, '/api/songs/136.json');
    expect(provider.getJson).toHaveBeenNthCalledWith(
      2,
      '/api/charts/136/expert.json',
    );
  });

  it('builds jacket paths from server priority and legacy song exceptions', () => {
    const repository = new SongResourceRepository(createProviderMock());

    expect(
      repository.getJacketImagePath(createSongSource(), [Server.cn, Server.jp]),
    ).toBe(
      '/assets/cn/musicjacket/musicjacket140_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket140-summerfest-jacket.png',
    );
    expect(
      repository.getJacketImagePath(
        createSongSource({
          publishedAt: [100, null, null, null, null],
          songId: 13,
        }),
        [Server.jp],
      ),
    ).toContain('/assets/jp/musicjacket/musicjacket30_rip/');
    expect(
      repository.getJacketImagePath(
        createSongSource({
          publishedAt: [100, null, null, null, null],
          songId: 273,
        }),
        [Server.jp],
      ),
    ).toContain('/assets/cn/musicjacket/musicjacket280_rip/');
  });

  it('falls back through server jacket paths when the primary asset is missing', async () => {
    const provider = createProviderMock();
    const validImage = Buffer.from('valid');
    provider.getAsset
      .mockResolvedValueOnce(assetErrorImageBuffer)
      .mockResolvedValueOnce(validImage);
    const repository = new SongResourceRepository(provider);

    await expect(
      repository.getJacketImageBuffer(createSongSource(), [Server.cn]),
    ).resolves.toBe(validImage);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/cn/musicjacket/musicjacket140_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket140-summerfest-jacket.png',
      { memoryCache: false },
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/jp/musicjacket/musicjacket140_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket140-SummerFest-jacket.png',
      { ignoreError: true, memoryCache: false, retryCount: 1 },
    );
  });
});
