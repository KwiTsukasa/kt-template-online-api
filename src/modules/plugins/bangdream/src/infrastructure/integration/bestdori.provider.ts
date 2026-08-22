import { callAPIAndCacheResponse } from '@/modules/plugins/bangdream/src/infrastructure/integration/api-cache.client';
import {
  type BangDreamAssetRequestOptions,
  type BangDreamDataProvider,
  type BangDreamJsonRequestOptions,
  type BangDreamTrackerRequestOptions,
  resolveBangDreamProviderUrl,
} from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import {
  withCache,
  withRetry,
  withTiming,
} from '@/modules/plugins/bangdream/src/infrastructure/integration/provider-decorators';
import { bestdoriUrl } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/plugins/bangdream/src/config/runtime-options';
import { readBangDreamRuntimeConfig } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

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
 * 按`fallback`读取运行态数量；当 `Number.isFinite(parsed) && parsed > 0` 成立时返回 `parsed`。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 运行态数量。
 */
function getRuntimeRetryCount(fallback: number): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.retryCount),
  );
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

/**
 * 根据`url`、`options`处理资源客户端；当 `options.memoryCache === false || options.overwrite` 成立时返回 `await downloadFile( url, ignoreError, optio…`。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param options - 控制资源客户端筛选、缓存或输出方式的可选项，包含 `ignoreError`、`memoryCache`、`overwrite`、`retryCount` 字段；省略时默认采用 `{}`。
 * @returns 资源客户端。
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
 * 根据`options`构造Bestdori数据提供器；从 `getRuntimeRetryCount` 读取Bestdori数据提供器。
 * @param options - 控制Bestdori数据提供器筛选、缓存或输出方式的可选项，包含 `baseUrl`、`jsonClient`、`assetClient`、`retryCount` 字段；省略时默认采用 `{}`。
 * @returns Bestdori数据提供器。
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
