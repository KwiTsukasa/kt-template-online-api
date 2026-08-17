import { fetchRemoteResourceJson } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/remote-resource.client';
import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-path';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import {
  getCacheClientErrorMessage,
  isCacheClientNotFound,
  runWithCacheClientRetry,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-policy';

/**
 * 根据`url`、`cacheTime`、`retryCount`处理调用APIAnd缓存响应；从 `getCacheDirectory` 读取调用APIAnd缓存响应。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param cacheTime - 决定调用APIAnd缓存响应内容、边界或目标的 `cacheTime` 值；省略时默认采用 `0`。
 * @param retryCount - 限制调用APIAnd缓存响应数量、尺寸、等级或重试边界的数值；省略时默认采用 `3`。
 * @returns 调用APIAnd缓存响应。
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
    action: () => fetchRemoteResourceJson(url, cacheDir, fileName, cacheTime),
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
