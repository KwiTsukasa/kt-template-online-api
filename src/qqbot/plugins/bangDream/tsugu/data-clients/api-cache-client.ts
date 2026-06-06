import { getJsonAndSave } from '@/qqbot/plugins/bangDream/tsugu/data-clients/file-cache-client';
import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/qqbot/plugins/bangDream/tsugu/data-clients/cache-path';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';

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
  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const data = await getJsonAndSave(url, cacheDir, fileName, cacheTime);
      return data;
    } catch (e) {
      if (e && e.response && e.response.status === 404) {
        // 当URL返回404错误后，不再重试，直接抛出错误。
        logger(
          `API`,
          `URL "${url}" returned 404 Not Found. No more retries will be made.`,
        );
        throw e;
      }
      logger(
        `API`,
        `Failed to get JSON from "${url}" on attempt ${attempt + 1}. Error: ${e.message}`,
      );
      if (attempt === retryCount - 1) {
        throw e; // Rethrow the error if all retries fail
      }
      //等待3秒后重试
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error(
    `Failed to get JSON from "${url}" after ${retryCount} attempts`,
  );
}

export { callAPIAndCacheResponse };
