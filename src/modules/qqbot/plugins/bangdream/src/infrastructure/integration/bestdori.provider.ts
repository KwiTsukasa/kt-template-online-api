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

/**
 * 查询 BangDream 插件数据。
 * @param fallback - 兜底值；驱动 `Number.isFinite()` 的 BangDream步骤。
 * @returns BangDream 插件查询结果。
 */
function getRuntimeRetryCount(fallback: number): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.retryCount),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；驱动 `downloadFile()`、`downloadFileCache()` 的 BangDream步骤。
 * @param options - BangDream列表；使用 `ignoreError`、`memoryCache`、`overwrite`、`retryCount` 字段生成结果。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
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

/**
 * 创建 BangDream 插件对象或配置。
 * @param options - BangDream列表；使用 `baseUrl`、`jsonClient`、`assetClient`、`retryCount` 字段生成结果。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
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
    /**
     * 执行 BangDream回调。
     * @param pathOrUrl - BangDream路径；驱动 `resolveBangDreamProviderUrl()` 的 BangDream步骤。
     */
    resolveUrl: (pathOrUrl: string) =>
      resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `resolveBangDreamProviderUrl()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；使用 `cacheTime`、`retryCount` 字段生成结果。
     */
    getJson: async <T = unknown>(
      pathOrUrl: string,
      requestOptions: BangDreamJsonRequestOptions = {},
    ) =>
      await jsonClient<T>(
        resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
        requestOptions.cacheTime,
        requestOptions.retryCount,
      ),
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `assetClient()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；驱动 `assetClient()` 的 BangDream步骤。
     */
    getAsset: async (
      pathOrUrl: string,
      requestOptions: BangDreamAssetRequestOptions = {},
    ) =>
      await assetClient(
        resolveBangDreamProviderUrl(baseUrl, pathOrUrl),
        requestOptions,
      ),
    /**
     * 读取 BangDream回调数据。
     * @param requestOptions - BangDream列表；使用 `server`、`eventId`、`tier`、`cacheTime` 字段生成结果。
     */
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
