import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  GachaResourceRepository,
  type GachaResourceSource,
} from '@/modules/qqbot/plugins/bangDream/gacha/gacha-resource.repository';
import { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

function createGachaSource(
  overrides: Partial<GachaResourceSource> = {},
): GachaResourceSource {
  return {
    bannerAssetBundleName: 'banner_gacha0259',
    gachaId: 259,
    publishedAt: [100, null, null, 200, null],
    resourceName: 'gacha0259',
    ...overrides,
  };
}

describe('BangDream gacha resource repository', () => {
  it('routes gacha detail requests through the provider with explicit cache policy', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ ok: true });
    const repository = new GachaResourceRepository(provider);

    await expect(repository.getDetail(259, true)).resolves.toEqual({
      ok: true,
    });
    await expect(repository.getDetail(259, false)).resolves.toEqual({
      ok: true,
    });

    expect(provider.getJson).toHaveBeenNthCalledWith(1, '/api/gacha/259.json', {
      cacheTime: 0,
    });
    expect(provider.getJson).toHaveBeenNthCalledWith(2, '/api/gacha/259.json', {
      cacheTime: Infinity,
    });
  });

  it('builds banner, background, fallback background, and logo paths', () => {
    const repository = new GachaResourceRepository(createProviderMock());
    const source = createGachaSource();
    const serverPriority = [Server.cn, Server.jp];

    expect(repository.getBannerImagePath(source)).toBe(
      '/assets/jp/homebanner_rip/banner_gacha0259.png',
    );
    expect(
      repository.getScreenImagePath(source, 'background', serverPriority),
    ).toBe('/assets/cn/gacha/screen/gacha0259_rip/bg.png');
    expect(
      repository.getScreenImagePath(
        source,
        'backgroundFallback',
        serverPriority,
      ),
    ).toBe('/assets/cn/gacha/screen/gacha0259_rip/bg1.png');
    expect(repository.getScreenImagePath(source, 'logo', serverPriority)).toBe(
      '/assets/cn/gacha/screen/gacha0259_rip/logo.png',
    );
  });

  it('falls back to logo when the banner is missing or unavailable', async () => {
    const provider = createProviderMock();
    const logoBuffer = Buffer.from('logo');
    provider.getAsset.mockResolvedValue(logoBuffer);
    const repository = new GachaResourceRepository(provider);

    await expect(
      repository.getBannerImageBuffer(
        createGachaSource({ bannerAssetBundleName: undefined }),
        [Server.cn, Server.jp],
      ),
    ).resolves.toBe(logoBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/cn/gacha/screen/gacha0259_rip/logo.png',
    );

    provider.getAsset.mockReset();
    provider.getAsset
      .mockRejectedValueOnce(new Error('banner missing'))
      .mockResolvedValueOnce(logoBuffer);

    await expect(
      repository.getBannerImageBuffer(createGachaSource(), [
        Server.cn,
        Server.jp,
      ]),
    ).resolves.toBe(logoBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/jp/homebanner_rip/banner_gacha0259.png',
      { ignoreError: false },
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/cn/gacha/screen/gacha0259_rip/logo.png',
    );
  });

  it('falls back from bg.png to bg1.png for gacha backgrounds', async () => {
    const provider = createProviderMock();
    const fallbackBuffer = Buffer.from('bg1');
    provider.getAsset
      .mockRejectedValueOnce(new Error('background missing'))
      .mockResolvedValueOnce(fallbackBuffer);
    const repository = new GachaResourceRepository(provider);

    await expect(
      repository.getBackgroundImageBuffer(createGachaSource(), [
        Server.cn,
        Server.jp,
      ]),
    ).resolves.toBe(fallbackBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/cn/gacha/screen/gacha0259_rip/bg.png',
      { ignoreError: false },
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/cn/gacha/screen/gacha0259_rip/bg1.png',
    );
  });
});
