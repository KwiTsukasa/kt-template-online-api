import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { PlayerDataRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-data.repository';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream player data repository', () => {
  it('builds player detail paths from server and mode', () => {
    const repository = new PlayerDataRepository(createProviderMock());

    expect(repository.getDetailPath(26591455, Server.jp, 3)).toBe(
      '/api/player/jp/26591455?mode=3',
    );
  });

  it('routes player detail requests through provider cache policy', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ result: true });
    const repository = new PlayerDataRepository(provider);

    await repository.getDetail(26591455, Server.jp, false, 3);
    await repository.getDetail(26591455, Server.jp, true, 0);

    expect(provider.getJson).toHaveBeenNthCalledWith(
      1,
      '/api/player/jp/26591455?mode=3',
      { cacheTime: 0, retryCount: 1 },
    );
    expect(provider.getJson).toHaveBeenNthCalledWith(
      2,
      '/api/player/jp/26591455?mode=0',
      { cacheTime: Infinity, retryCount: 1 },
    );
  });

  it('keeps Bestdori mode 1 background refresh behavior', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ result: true });
    const repository = new PlayerDataRepository(provider);

    await repository.getDetail(26591455, Server.jp, true, 1);

    expect(provider.getJson).toHaveBeenNthCalledWith(
      1,
      '/api/player/jp/26591455?mode=1',
      { cacheTime: Infinity, retryCount: 1 },
    );
    expect(provider.getJson).toHaveBeenNthCalledWith(
      2,
      '/api/player/jp/26591455?mode=1',
      { cacheTime: 300, retryCount: 1 },
    );
  });
});
