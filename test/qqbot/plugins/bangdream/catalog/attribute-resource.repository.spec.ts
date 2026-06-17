import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { AttributeResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute-resource.repository';

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
