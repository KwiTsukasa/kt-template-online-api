import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { CutoffEventTopRepository } from '@/qqbot/plugins/bangDream/tsugu/models/cutoff-event-top-repository';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream cutoff event top repository', () => {
  it('builds event top data paths', () => {
    const repository = new CutoffEventTopRepository(createProviderMock());

    expect(repository.getTopDataPath(50, Server.cn)).toBe(
      '/api/eventtop/data?server=3&event=50&mid=0&interval=3600000',
    );
  });

  it('routes event top data requests through the provider', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({
      points: [{ time: 1, uid: 2, value: 3 }],
      users: [],
    });
    const repository = new CutoffEventTopRepository(provider);

    await expect(repository.getTopData(50, Server.cn)).resolves.toEqual({
      points: [{ time: 1, uid: 2, value: 3 }],
      users: [],
    });

    expect(provider.getJson).toHaveBeenCalledWith(
      '/api/eventtop/data?server=3&event=50&mid=0&interval=3600000',
    );
  });
});
