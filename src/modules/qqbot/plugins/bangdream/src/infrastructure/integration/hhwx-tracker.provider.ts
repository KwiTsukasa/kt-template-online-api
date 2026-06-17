import { callAPIAndCacheResponse } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/api-cache.client';
import {
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
import { hhwxUrl } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import { readBangDreamRuntimeConfig } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export interface BangDreamHhwxTrackerProviderOptions {
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
 * 创建 BangDream 插件对象或配置。
 * @param options - BangDream列表；使用 `baseUrl`、`jsonClient`、`retryCount` 字段生成结果。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
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
     */
    getAsset: async () => {
      throw new Error('HHWX provider does not support asset requests');
    },
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

export const bangdreamHhwxTrackerProvider = createHhwxTrackerProvider();
