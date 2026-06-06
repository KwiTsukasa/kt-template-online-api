import {
  createBestdoriProvider,
  type BangDreamBestdoriProviderOptions,
} from '@/qqbot/plugins/bangDream/provider/bestdori.provider';
import { createHhwxTrackerProvider } from '@/qqbot/plugins/bangDream/provider/hhwx-tracker.provider';
import {
  resolveBangDreamProviderUrl,
  type BangDreamDataProvider,
} from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  withCache,
  withRetry,
} from '@/qqbot/plugins/bangDream/provider/provider-decorators';

describe('BangDream data provider', () => {
  it('resolves relative paths against provider base url', () => {
    expect(
      resolveBangDreamProviderUrl('https://bestdori.example/', '/api/a.json'),
    ).toBe('https://bestdori.example/api/a.json');
    expect(
      resolveBangDreamProviderUrl('https://bestdori.example', 'api/a.json'),
    ).toBe('https://bestdori.example/api/a.json');
    expect(
      resolveBangDreamProviderUrl(
        'https://bestdori.example',
        'https://cdn.example/a.png',
      ),
    ).toBe('https://cdn.example/a.png');
  });

  it('allows Bestdori JSON and asset clients to be mocked', async () => {
    const jsonClient: BangDreamBestdoriProviderOptions['jsonClient'] = jest
      .fn()
      .mockResolvedValue({ ok: true });
    const assetClient: BangDreamBestdoriProviderOptions['assetClient'] = jest
      .fn()
      .mockResolvedValue(Buffer.from('asset'));
    const provider = createBestdoriProvider({
      assetClient,
      baseUrl: 'https://bestdori.example/',
      jsonClient,
      retryCount: 1,
    });

    await expect(
      provider.getJson('/api/songs/1.json', { cacheTime: 30, retryCount: 1 }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.getAsset('/assets/a.png', { ignoreError: false }),
    ).resolves.toEqual(Buffer.from('asset'));

    expect(jsonClient).toHaveBeenCalledWith(
      'https://bestdori.example/api/songs/1.json',
      30,
      1,
    );
    expect(assetClient).toHaveBeenCalledWith(
      'https://bestdori.example/assets/a.png',
      expect.objectContaining({ ignoreError: false, retryCount: 1 }),
    );
  });

  it('routes HHWX tracker calls through the tracker provider path', async () => {
    const jsonClient = jest.fn().mockResolvedValue({ result: true });
    const provider = createHhwxTrackerProvider({
      baseUrl: 'https://hhwx.example',
      jsonClient,
      retryCount: 1,
    });

    await expect(
      provider.getTracker({
        cacheTime: 60,
        eventId: 100,
        server: 3,
        tier: 1000,
      }),
    ).resolves.toEqual({ result: true });

    expect(jsonClient).toHaveBeenCalledWith(
      'https://hhwx.example/api/bandori/tracker/data?server=3&event=100&tier=1000',
      60,
      1,
    );
  });

  it('wraps provider retry and cache options without changing provider shape', async () => {
    const getJson = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ ok: true });
    const baseProvider: BangDreamDataProvider = {
      name: 'Mock',
      resolveUrl: (pathOrUrl) => pathOrUrl,
      getJson,
      getAsset: jest.fn(),
      getTracker: jest.fn(),
    };
    const provider = withRetry(withCache(baseProvider, { jsonCacheTime: 90 }), {
      retryCount: 2,
    });

    await expect(provider.getJson('/api/mock.json')).resolves.toEqual({
      ok: true,
    });
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(getJson).toHaveBeenLastCalledWith('/api/mock.json', {
      cacheTime: 90,
      retryCount: 1,
    });
  });
});
