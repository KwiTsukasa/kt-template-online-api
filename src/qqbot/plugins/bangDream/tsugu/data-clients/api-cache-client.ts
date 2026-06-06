import { getJsonAndSave } from '@/qqbot/plugins/bangDream/tsugu/data-clients/file-cache-client';
import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/qqbot/plugins/bangDream/tsugu/data-clients/cache-path';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';
import {
  getCacheClientErrorMessage,
  isCacheClientNotFound,
  runWithCacheClientRetry,
} from '@/qqbot/plugins/bangDream/tsugu/data-clients/cache-client-policy';

/**
 * 在数据下载与缓存层中调用APIAnd缓存Response。
 *
 * @param url - 远端资源地址。
 * @param cacheTime - 缓存时间参数，未传入时使用默认值。
 * @param retryCount - retryCount参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
async function callAPIAndCacheResponse(
  url: string,
  cacheTime: number = 0,
  retryCount: number = 3,
): Promise<object> {
  if (url.includes('hhwx.org/api/tracker/data')) {
    url = url.replace(
      'hhwx.org/api/tracker/data',
      'hhwx.org/api/bandori/tracker/data',
    ); // HHWX数据源修复
  }
  const cacheDir = getCacheDirectory(url);
  const fileName = getFileNameFromUrl(url);
  return await runWithCacheClientRetry({
    action: () => getJsonAndSave(url, cacheDir, fileName, cacheTime),
    onFailure: (attempt, _retryCount, error) => {
      if (isCacheClientNotFound(error)) {
        logger(
          `API`,
          `URL "${url}" returned 404 Not Found. No more retries will be made.`,
        );
        return;
      }
      logger(
        `API`,
        `Failed to get JSON from "${url}" on attempt ${attempt}. Error: ${getCacheClientErrorMessage(error)}`,
      );
    },
    retryCount,
    shouldRetry: (error) => !isCacheClientNotFound(error),
  });
}

export { callAPIAndCacheResponse };
