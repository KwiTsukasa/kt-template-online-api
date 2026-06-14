import { callAPIAndCacheResponse } from '@/modules/qqbot/plugins/bangDream/provider/api-cache.client';
import {
  type BangDreamDataProvider,
  type BangDreamJsonRequestOptions,
  type BangDreamTrackerRequestOptions,
  resolveBangDreamProviderUrl,
} from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  withCache,
  withRetry,
  withTiming,
} from '@/modules/qqbot/plugins/bangDream/provider/provider-decorators';
import { hhwxUrl } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/qqbot/plugins/bangDream/config/runtime-options';

export interface BangDreamHhwxTrackerProviderOptions {
  baseUrl?: string;
  jsonClient?: <T = unknown>(
    url: string,
    cacheTime?: number,
    retryCount?: number,
  ) => Promise<T>;
  retryCount?: number;
}

function getRuntimeRetryCount(fallback: number): number {
  const parsed = Number(process.env[BANGDREAM_TSUGU_ENV_KEYS.retryCount]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createHhwxTrackerProvider(
  options: BangDreamHhwxTrackerProviderOptions = {},
): BangDreamDataProvider {
  const baseUrl = options.baseUrl ?? hhwxUrl;
  const jsonClient =
    options.jsonClient ??
    (<T = unknown>(url: string, cacheTime?: number, retryCount?: number) =>
      callAPIAndCacheResponse(url, cacheTime, retryCount) as Promise<T>);
  const provider: BangDreamDataProvider = {
    name: 'HHWX',
    resolveUrl: (pathOrUrl: string) =>
      resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
    getJson: async <T = unknown>(
      pathOrUrl: string,
      requestOptions: BangDreamJsonRequestOptions = {},
    ) =>
      await jsonClient<T>(
        resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
        requestOptions.cacheTime,
        requestOptions.retryCount,
      ),
    getAsset: async () => {
      throw new Error('HHWX provider does not support asset requests');
    },
    getTracker: async <T = unknown>(
      requestOptions: BangDreamTrackerRequestOptions,
    ) =>
      await jsonClient<T>(
        resolveBangDreamProviderUrl(
          baseUrl,
          `/api/bandori/tracker/data?server=${requestOptions.server}&event=${requestOptions.eventId}&tier=${requestOptions.tier}`,
        ),
        requestOptions.cacheTime,
        requestOptions.retryCount,
      ),
  };
  return withTiming(
    withRetry(withCache(provider), {
      retryCount: options.retryCount ?? getRuntimeRetryCount(3),
      delayMs: 3000,
    }),
  );
}

export const bangDreamHhwxTrackerProvider = createHhwxTrackerProvider();
