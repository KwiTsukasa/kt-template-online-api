import { callAPIAndCacheResponse } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/api-cache.client';
import {
  type BangDreamAssetRequestOptions,
  type BangDreamDataProvider,
  type BangDreamJsonRequestOptions,
  type BangDreamTrackerRequestOptions,
  resolveBangDreamProviderUrl,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  withCache,
  withRetry,
  withTiming,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/provider-decorators';
import { bestdoriUrl } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import { readBangDreamRuntimeConfig } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export interface BangDreamBestdoriProviderOptions {
  assetClient?: (
    url: string,
    options?: BangDreamAssetRequestOptions,
  ) => Promise<Buffer>;
  baseUrl?: string;
  jsonClient?: <T = unknown>(
    url: string,
    cacheTime?: number,
    retryCount?: number,
  ) => Promise<T>;
  retryCount?: number;
}

function getRuntimeRetryCount(fallback: number): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.retryCount),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function defaultAssetClient(
  url: string,
  options: BangDreamAssetRequestOptions = {},
): Promise<Buffer> {
  const { downloadFile, downloadFileCache } =
    await import('../storage/asset-cache.client');
  const ignoreError = options.ignoreError ?? true;
  if (options.memoryCache === false || options.overwrite) {
    return await downloadFile(
      url,
      ignoreError,
      options.overwrite,
      options.retryCount,
    );
  }
  return await downloadFileCache(url, ignoreError);
}

export function createBestdoriProvider(
  options: BangDreamBestdoriProviderOptions = {},
): BangDreamDataProvider {
  const baseUrl = options.baseUrl ?? bestdoriUrl;
  const jsonClient =
    options.jsonClient ??
    (<T = unknown>(url: string, cacheTime?: number, retryCount?: number) =>
      callAPIAndCacheResponse(url, cacheTime, retryCount) as Promise<T>);
  const assetClient = options.assetClient ?? defaultAssetClient;
  const provider: BangDreamDataProvider = {
    name: 'Bestdori',
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
    getAsset: async (
      pathOrUrl: string,
      requestOptions: BangDreamAssetRequestOptions = {},
    ) =>
      await assetClient(
        resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
        requestOptions,
      ),
    getTracker: async <T = unknown>(
      requestOptions: BangDreamTrackerRequestOptions,
    ) =>
      await jsonClient<T>(
        resolveBangDreamProviderUrl(
          baseUrl,
          `/api/tracker/data?server=${requestOptions.server}&event=${requestOptions.eventId}&tier=${requestOptions.tier}`,
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

export const bangdreamBestdoriProvider = createBestdoriProvider();
