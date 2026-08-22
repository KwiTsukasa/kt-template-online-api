import { callAPIAndCacheResponse } from '@/modules/plugins/bangdream/src/infrastructure/integration/api-cache.client';
import {
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
import { hhwxUrl } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/plugins/bangdream/src/config/runtime-options';
import { readBangDreamRuntimeConfig } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

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
 * 根据`options`构造Hhwx档线数据源数据提供器；从 `getRuntimeRetryCount` 读取Hhwx档线数据源数据提供器。
 * @param options - 控制Hhwx档线数据源数据提供器筛选、缓存或输出方式的可选项，包含 `baseUrl`、`jsonClient`、`retryCount` 字段；省略时默认采用 `{}`。
 * @returns Hhwx档线数据源数据提供器。
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

export const bangdreamHhwxTrackerProvider = createHhwxTrackerProvider();
