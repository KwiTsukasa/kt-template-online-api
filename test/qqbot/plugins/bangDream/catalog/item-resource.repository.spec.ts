import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  ItemResourceRepository,
  type ItemResourceSource,
} from '@/qqbot/plugins/bangDream/catalog/item-resource.repository';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

function createItemSource(
  overrides: Partial<ItemResourceSource> = {},
): ItemResourceSource {
  return {
    resourceId: 7,
    typeName: 'gacha_ticket_',
    ...overrides,
  };
}

describe('BangDream item resource repository', () => {
  it('builds material, star, and common item image paths', () => {
    const repository = new ItemResourceRepository(createProviderMock());

    expect(
      repository.getImagePath(
        createItemSource({ resourceId: 3, typeName: 'material' }),
        Server.cn,
      ),
    ).toBe('/assets/cn/thumb/material_rip/material003.png');
    expect(
      repository.getImagePath(createItemSource({ typeName: 'star' }), Server.jp),
    ).toBe('/assets/jp/thumb/common_rip/star.png');
    expect(repository.getImagePath(createItemSource(), Server.cn)).toBe(
      '/assets/cn/thumb/common_rip/gacha_ticket_7.png',
    );
  });

  it('downloads item images through the provider', async () => {
    const provider = createProviderMock();
    const itemBuffer = Buffer.from('item');
    provider.getAsset.mockResolvedValue(itemBuffer);
    const repository = new ItemResourceRepository(provider);

    await expect(
      repository.getImageBuffer(createItemSource(), Server.cn),
    ).resolves.toBe(itemBuffer);

    expect(provider.getAsset).toHaveBeenCalledWith(
      '/assets/cn/thumb/common_rip/gacha_ticket_7.png',
    );
  });
});
