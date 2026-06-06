import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { CostumeResourceRepository } from '@/qqbot/plugins/bangDream/catalog/costume-resource.repository';
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

describe('BangDream costume resource repository', () => {
  it('loads costume details through the provider', async () => {
    const provider = createProviderMock();
    const detail = { costumeId: 472, sdResourceName: 'sd_001' };
    provider.getJson.mockResolvedValue(detail);
    const repository = new CostumeResourceRepository(provider);

    await expect(repository.getDetail(472)).resolves.toBe(detail);

    expect(provider.getJson).toHaveBeenCalledWith('/api/costumes/472.json');
  });

  it('builds and downloads sd character assets through the provider', async () => {
    const provider = createProviderMock();
    const sdCharacterBuffer = Buffer.from('sd-character');
    provider.getAsset.mockResolvedValue(sdCharacterBuffer);
    const repository = new CostumeResourceRepository(provider);
    const source = {
      publishedAt: [100, null, null, 200, null],
      sdResourceName: 'sd_001',
    };

    expect(repository.getSdCharacterPath(source, [Server.cn])).toBe(
      '/assets/cn/characters/livesd/sd_001_rip/sdchara.png',
    );
    await expect(
      repository.getSdCharacterBuffer(source, [Server.cn]),
    ).resolves.toBe(sdCharacterBuffer);

    expect(provider.getAsset).toHaveBeenCalledWith(
      '/assets/cn/characters/livesd/sd_001_rip/sdchara.png',
      { memoryCache: false },
    );
  });
});
