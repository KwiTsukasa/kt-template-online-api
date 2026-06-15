import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { ServerResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server-resource.repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream server resource repository', () => {
  it('builds server icon paths', () => {
    const repository = new ServerResourceRepository(createProviderMock());

    expect(repository.getIconSvgPath('cn')).toBe('/res/icon/cn.svg');
    expect(repository.getTwIconPath().replace(/\\/g, '/')).toMatch(
      /\/tw\.png$/,
    );
  });

  it('downloads server icon assets through the provider', async () => {
    const provider = createProviderMock();
    const iconBuffer = Buffer.from('<svg />');
    provider.getAsset.mockResolvedValue(iconBuffer);
    const repository = new ServerResourceRepository(provider);

    await expect(repository.getIconSvgBuffer('cn')).resolves.toBe(iconBuffer);

    expect(provider.getAsset).toHaveBeenCalledWith('/res/icon/cn.svg');
  });
});
