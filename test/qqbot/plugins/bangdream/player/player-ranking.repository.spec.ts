import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { PlayerRankingResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-ranking.repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream player ranking resource repository', () => {
  it('builds player ranking image paths', () => {
    const repository = new PlayerRankingResourceRepository(
      createProviderMock(),
    );

    expect(repository.getRankImagePath(Server.cn, 1)).toBe(
      '/res/image/cn_1.png',
    );
  });

  it('downloads player ranking images through the provider', async () => {
    const provider = createProviderMock();
    const rankBuffer = Buffer.from('rank');
    provider.getAsset.mockResolvedValue(rankBuffer);
    const repository = new PlayerRankingResourceRepository(provider);

    await expect(repository.getRankImageBuffer(Server.cn, 1)).resolves.toBe(
      rankBuffer,
    );

    expect(provider.getAsset).toHaveBeenCalledWith('/res/image/cn_1.png');
  });
});
