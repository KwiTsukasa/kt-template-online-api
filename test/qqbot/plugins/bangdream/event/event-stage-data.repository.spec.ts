import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { EventStageDataRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage-data.repository';

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

describe('BangDream event stage data repository', () => {
  it('routes stage and rotation music requests through the provider', async () => {
    const provider = createProviderMock();
    provider.getJson
      .mockResolvedValueOnce([{ type: 'combo' }])
      .mockResolvedValueOnce([{ musicId: '136' }]);
    const repository = new EventStageDataRepository(provider);

    await expect(repository.getFestivalData(310, 'stages')).resolves.toEqual([
      { type: 'combo' },
    ]);
    await expect(
      repository.getFestivalData(310, 'rotationMusics'),
    ).resolves.toEqual([{ musicId: '136' }]);

    expect(provider.getJson).toHaveBeenNthCalledWith(
      1,
      '/api/festival/stages/310.json',
      { cacheTime: 0 },
    );
    expect(provider.getJson).toHaveBeenNthCalledWith(
      2,
      '/api/festival/rotationMusics/310.json',
      { cacheTime: 0 },
    );
  });

  it('uses an infinite cache when update is disabled', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue([]);
    const repository = new EventStageDataRepository(provider);

    await repository.getFestivalData(310, 'stages', false);

    expect(provider.getJson).toHaveBeenCalledWith(
      '/api/festival/stages/310.json',
      { cacheTime: Infinity },
    );
  });
});
