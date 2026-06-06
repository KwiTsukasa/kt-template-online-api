import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import {
  EventDataRepository,
  type EventAssetContext,
} from '@/qqbot/plugins/bangDream/tsugu/models/event-data-repository';
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

function createEventAssetContext(): EventAssetContext {
  return {
    assetBundleName: 'event_test',
    bannerAssetBundleName: 'homebanner_test',
    startAt: [1, null, null, 2, null],
  };
}

describe('BangDream event data repository', () => {
  it('builds event background paths from the requested server priority', () => {
    const repository = new EventDataRepository(createProviderMock());
    const event = createEventAssetContext();

    expect(repository.getBackgroundImagePath(event, [Server.jp])).toBe(
      '/assets/jp/event/event_test/topscreen_rip/bg_eventtop.png',
    );
    expect(repository.getTopscreenTrimImagePath(event, [Server.jp])).toBe(
      '/assets/jp/event/event_test/topscreen_rip/trim_eventtop.png',
    );
  });

  it('falls back to released servers when requested server has no event assets', () => {
    const repository = new EventDataRepository(createProviderMock());
    const event = createEventAssetContext();

    expect(repository.getBackgroundImagePath(event, [Server.en])).toBe(
      '/assets/cn/event/event_test/topscreen_rip/bg_eventtop.png',
    );
  });

  it('routes event detail requests through the provider cache policy', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ eventName: ['test'] });
    const repository = new EventDataRepository(provider);

    await expect(repository.getDetail(50, false)).resolves.toEqual({
      eventName: ['test'],
    });

    expect(provider.getJson).toHaveBeenCalledWith('/api/events/50.json', {
      cacheTime: Infinity,
    });
  });
});
