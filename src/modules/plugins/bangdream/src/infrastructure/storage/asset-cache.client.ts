import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/modules/plugins/bangdream/src/infrastructure/storage/cache-path';
import { fetchRemoteResourceBuffer } from '@/modules/plugins/bangdream/src/infrastructure/storage/remote-resource.client';
import { Buffer } from 'buffer';
import { assetErrorImageBuffer } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import { readBangDreamRuntimeConfig } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';
import {
  BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS,
  getCacheClientErrorMessage,
  getCacheClientResponseStatus,
  runWithCacheClientRetry,
} from '@/modules/plugins/bangdream/src/infrastructure/storage/cache-policy';

const errUrl: { [key: string]: number } = {};
const memoryCache: { [url: string]: Buffer } = {};

/**
 * 根据`url`、`ignoreError`、`overwrite`处理下载任务文件；当 `(url.includes('.png') || url.includes('.svg')) && ignoreError` 成立时返回 `assetErrorImageBuffer`。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param ignoreError - 决定是否启用“ignore错误”分支的布尔选项；省略时默认采用 `true`。
 * @param overwrite - 决定下载任务文件内容、边界或目标的 `overwrite` 值；省略时默认采用 `false`。
 * @param retryCount - 限制下载任务文件数量、尺寸、等级或重试边界的数值；省略时默认采用 `3`。
 * @returns 下载任务文件。
 * @throws 当 `url.includes('undefined')` 成立时拒绝当前输入并抛出 `Error`；当 `errUrl[url] && currentTime - errUrl[url] < BANGDREAM_MISSING_URL_CACHE_…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `url.includes` 或 `() => { if (overwrite) { return 0; } return 1 / 0; }` 调用失败时拒绝当前输入并抛出 `e`。
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

    const cacheTime = (() => {
      if (overwrite) {
        return 0;
      }
      return 1 / 0;
    })();
    const cacheDir = getCacheDirectory(url);
    const fileName = getFileNameFromUrl(url);

    let assetNotExists = false;
    return await runWithCacheClientRetry({
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
      onRetry: (nextAttempt, normalizedRetryCount) =>
        logger(
          `downloader`,
          `Retrying download for "${url}" (attempt ${nextAttempt}/${normalizedRetryCount})`,
        ),
      retryCount,
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
 * 根据`url`、`ignoreError`处理下载任务文件缓存；当 `memoryCache[url]` 成立时返回 `memoryCache[url]`。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param ignoreError - 决定是否启用“ignore错误”分支的布尔选项；省略时默认采用 `true`。
 * @returns 下载任务文件缓存。
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
