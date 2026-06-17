import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { BandResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band-resource.repository';

/**
 * 创建 BangDream 插件对象或配置。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream band resource repository', () => {
  it('builds band logo and icon paths', () => {
    const repository = new BandResourceRepository(createProviderMock());

    expect(repository.getLogoPath(1)).toBe(
      '/assets/jp/band/logo/001_rip/logoL.png',
    );
    expect(repository.getIconSvgPath(1)).toBe('/res/icon/band_1.svg');
  });

  it('downloads band logo and icon assets through the provider', async () => {
    const provider = createProviderMock();
    const logoBuffer = Buffer.from('logo');
    const iconBuffer = Buffer.from('<svg />');
    provider.getAsset
      .mockResolvedValueOnce(logoBuffer)
      .mockResolvedValueOnce(iconBuffer);
    const repository = new BandResourceRepository(provider);

    await expect(repository.getLogoBuffer(1)).resolves.toBe(logoBuffer);
    await expect(repository.getIconSvgBuffer(1)).resolves.toBe(iconBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/jp/band/logo/001_rip/logoL.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/res/icon/band_1.svg',
    );
  });
});
