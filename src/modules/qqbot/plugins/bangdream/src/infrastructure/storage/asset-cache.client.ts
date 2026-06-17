import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-path';
import { fetchRemoteResourceBuffer } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/remote-resource.client';
import { Buffer } from 'buffer';
import { assetErrorImageBuffer } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import { readBangDreamRuntimeConfig } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
import {
  BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS,
  getCacheClientErrorMessage,
  getCacheClientResponseStatus,
  runWithCacheClientRetry,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-policy';

const errUrl: { [key: string]: number } = {};
const memoryCache: { [url: string]: Buffer } = {};

/**
 * 在数据下载与缓存层中下载File。
 *
 * @param url - 访问地址；计算 BangDream布尔判断。
 * @param ignoreError - ignoreError 输入；影响 downloadFile 的返回值。
 * @param overwrite - overwrite 输入；影响 downloadFile 的返回值。
 * @param retryCount - retryCount 输入；影响 downloadFile 的返回值。
 * @returns 异步处理结果。
 */
async function downloadFile(
  url: string,
  ignoreError: boolean = true,
  overwrite = false,
  retryCount = 3,
): Promise<Buffer> {
  try {
    const currentTime = Date.now();
    if (url.includes('undefined')) {
      throw new Error("downloadFile: url.includes('undefined')");
    }

    if (
      errUrl[url] &&
      currentTime - errUrl[url] < BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS
    ) {
      throw new Error('downloadFile: errUrl includes url and not expired');
    }

    const cacheTime = overwrite ? 0 : 1 / 0;
    const cacheDir = getCacheDirectory(url);
    const fileName = getFileNameFromUrl(url);

    let assetNotExists = false;
    return await runWithCacheClientRetry({
      /**
       * 执行 BangDream回调。
       */
      action: async () => {
        assetNotExists = false;
        const data = await fetchRemoteResourceBuffer(
          url,
          cacheDir,
          fileName,
          cacheTime,
        );
        const htmlSig = Buffer.from('<!DOCTYPE html>');
        const slice = Buffer.from(data.subarray(0, htmlSig.length));
        if (slice.equals(htmlSig)) {
          assetNotExists = true;
          throw new Error(
            'downloadFile: data.toString().startsWith("<!DOCTYPE html>")',
          );
        }
        return data;
      },
      /**
       * 执行 BangDream回调。
       * @param nextAttempt - nextAttempt 输入；影响 onRetry 的返回值。
       * @param normalizedRetryCount - normalizedRetryCount 输入；影响 onRetry 的返回值。
       */
      onRetry: (nextAttempt, normalizedRetryCount) =>
        logger(
          `downloader`,
          `Retrying download for "${url}" (attempt ${nextAttempt}/${normalizedRetryCount})`,
        ),
      retryCount,
      /**
       * 执行 BangDream回调。
       */
      shouldRetry: () => !assetNotExists,
    });
  } catch (e) {
    logger(
      `downloader`,
      `Failed to download file from "${url}". Error: ${getCacheClientErrorMessage(e)}`,
    );

    if (getCacheClientResponseStatus(e) === 404) {
      errUrl[url] = Date.now();
    }

    if ((url.includes('.png') || url.includes('.svg')) && ignoreError) {
      return assetErrorImageBuffer;
    }

    throw e; // 抛出错误
  }
}

/**
 * 在数据下载与缓存层中下载File缓存。
 *
 * @param url - 访问地址；驱动 `downloadFile()` 的 BangDream步骤。
 * @param ignoreError - ignoreError 输入；驱动 `downloadFile()` 的 BangDream步骤。
 * @returns 异步处理结果。
 */
async function downloadFileCache(
  url: string,
  ignoreError = true,
): Promise<Buffer> {
  if (memoryCache[url]) {
    return memoryCache[url];
  }
  const data = await downloadFile(url, ignoreError);
  if (readBangDreamRuntimeConfig('MEMORY_CACHE') === 'true') {
    memoryCache[url] = data;
  }
  return data;
}

export { downloadFile, downloadFileCache };
