import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { AttributeResourceRepository } from '@/qqbot/plugins/bangDream/catalog/attribute-resource.repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream attribute resource repository', () => {
  it('builds attribute icon paths', () => {
    const repository = new AttributeResourceRepository(createProviderMock());

    expect(repository.getIconSvgPath('powerful')).toBe(
      '/res/icon/powerful.svg',
    );
  });

  it('downloads attribute icon assets through the provider', async () => {
    const provider = createProviderMock();
    const iconBuffer = Buffer.from('<svg />');
    provider.getAsset.mockResolvedValue(iconBuffer);
    const repository = new AttributeResourceRepository(provider);

    await expect(repository.getIconSvgBuffer('powerful')).resolves.toBe(
      iconBuffer,
    );

    expect(provider.getAsset).toHaveBeenCalledWith('/res/icon/powerful.svg');
  });
});
