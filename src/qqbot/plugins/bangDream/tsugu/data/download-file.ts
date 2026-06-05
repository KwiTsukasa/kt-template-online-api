import * as path from 'path';
import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/qqbot/plugins/bangDream/tsugu/data/utils';
import { download } from '@/qqbot/plugins/bangDream/tsugu/data/downloader';
import { Buffer } from 'buffer';
import { assetErrorImageBuffer } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-logger';
import * as fs from 'fs';

// 错误 URL 列表和错误缓存过期时间
const errUrl: { [key: string]: number } = {};
const ERROR_CACHE_EXPIRY = 12 * 60 * 60 * 1000; // 1 天
const memoryCache: { [url: string]: Buffer } = {};

async function downloadFile(
  url: string,
  IgnoreErr: boolean = true,
  overwrite = false,
  retryCount = 3,
): Promise<Buffer> {
  try {
    const currentTime = Date.now();
    if (url.includes('undefined')) {
      throw new Error("downloadFile: url.includes('undefined')");
    }

    if (errUrl[url] && currentTime - errUrl[url] < ERROR_CACHE_EXPIRY) {
      throw new Error('downloadFile: errUrl includes url and not expired');
    }

    const cacheTime = overwrite ? 0 : 1 / 0;
    const cacheDir = getCacheDirectory(url);
    const fileName = getFileNameFromUrl(url);

    for (let attempt = 0; attempt < retryCount; attempt++) {
      let assetNotExists = false;
      if (attempt > 0) {
        logger(
          `downloader`,
          `Retrying download for "${url}" (attempt ${attempt + 1}/${retryCount})`,
        );
      }
      try {
        const data = await download(url, cacheDir, fileName, cacheTime);
        const htmlSig = Buffer.from('<!DOCTYPE html>');
        const slice = Buffer.from(data.subarray(0, htmlSig.length));
        if (slice.equals(htmlSig)) {
          fs.unlinkSync(path.join(cacheDir, fileName));
          assetNotExists = true;
          throw new Error(
            'downloadFile: data.toString().startsWith("<!DOCTYPE html>")',
          );
        }
        return data;
      } catch (e) {
        if (attempt === retryCount - 1) {
          throw e;
        }
        if (assetNotExists) {
          throw e;
        }
        //等待3秒后重试
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } catch (e) {
    logger(
      `downloader`,
      `Failed to download file from "${url}". Error: ${e.message}`,
    );

    if (e.message.includes('404')) {
      errUrl[url] = Date.now();
    }

    if ((url.includes('.png') || url.includes('.svg')) && IgnoreErr) {
      return assetErrorImageBuffer;
    }

    throw e; // 抛出错误
  }
}

async function downloadFileCache(
  url: string,
  IgnoreErr = true,
): Promise<Buffer> {
  if (memoryCache[url]) {
    return memoryCache[url];
  }
  const data = await downloadFile(url, IgnoreErr);
  if (process.env.MEMORY_CACHE == 'true') {
    memoryCache[url] = data;
  }
  return data;
}

export { downloadFile, downloadFileCache };
