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
 * 在数据下载与缓存层中调用APIAnd缓存Response。
 *
 * @param url - 访问地址；计算 BangDream布尔判断。
 * @param cacheTime - cacheTime 输入；驱动 `fetchRemoteResourceJson()` 的 BangDream步骤。
 * @param retryCount - retryCount 输入；影响 callAPIAndCacheResponse 的返回值。
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
    /**
     * 执行 BangDream回调。
     */
    action: () => fetchRemoteResourceJson(url, cacheDir, fileName, cacheTime),
    /**
     * 执行 BangDream回调。
     * @param attempt - attempt 输入；影响 onFailure 的返回值。
     * @param _retryCount - _retryCount 输入；影响 onFailure 的返回值。
     * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
     */
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
    /**
     * 执行 BangDream回调。
     * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
     */
    shouldRetry: (error) => !isCacheClientNotFound(error),
  });
}

export { callAPIAndCacheResponse };
