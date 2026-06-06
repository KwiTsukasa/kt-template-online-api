import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamPositiveInteger,
} from '@/qqbot/plugins/bangDream/config/runtime-options';
import {
  BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS,
  getCacheClientErrorMessage,
  getCacheClientResponseStatus,
} from '@/qqbot/plugins/bangDream/provider/cache-policy';

const errorUrlCache: { [url: string]: number } = {};
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

function getRequestTimeoutMs(): number {
  return normalizeBangDreamPositiveInteger(
    process.env[BANGDREAM_TSUGU_ENV_KEYS.requestTimeoutMs],
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

/**
 * 在数据下载与缓存层中下载当前数据。
 *
 * @param url - 远端资源地址。
 * @param directory - directory参数，未传入时使用默认值。
 * @param fileName - file名称参数，未传入时使用默认值。
 * @param cacheTime - 缓存时间参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function download(
  url: string,
  directory?: string,
  fileName?: string,
  cacheTime = 0,
): Promise<Buffer> {
  if (directory != undefined && fileName != undefined) {
    ensureDirectoryExists(directory);
  }
  try {
    if (isErrorUrlCacheActive(url)) {
      throw new Error('downloadFile: errorUrlCache includes url');
    }
    let eTag: string | undefined;
    const cacheFilePath = path.join(directory || '', `${fileName || ''}`);
    if (fileName && directory) {
      const eTagFilePath = path.join(directory, `${fileName}.etag`);
      eTag = fs.existsSync(eTagFilePath)
        ? fs.readFileSync(eTagFilePath, 'utf-8')
        : undefined;
      if (fs.existsSync(cacheFilePath)) {
        const stat = fs.statSync(cacheFilePath);
        const now = Date.now();
        if (now - stat.mtimeMs < cacheTime * 1000) {
          const cachedData = fs.readFileSync(cacheFilePath);
          return cachedData;
        }
      }
    }
    const headers = eTag ? { 'If-None-Match': eTag } : {};
    let response;
    try {
      response = await axios.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: getRequestTimeoutMs(),
      });
    } catch (error) {
      if (error.response && error.response.status === 304) {
        const cachedData = fs.readFileSync(cacheFilePath);
        return cachedData;
      } else {
        throw error;
      }
    }

    const fileBuffer = Buffer.from(response.data, 'binary');

    const newETag = response.headers.etag;
    if (newETag && directory && fileName) {
      fs.writeFileSync(path.join(directory, `${fileName}.etag`), newETag);
    }

    if (directory && fileName) {
      fs.writeFileSync(path.join(directory, fileName), fileBuffer);
    }
    return fileBuffer;
  } catch (e) {
    if (getCacheClientResponseStatus(e) === 404) {
      errorUrlCache[url] = Date.now();
    }
    if (url.includes('.png') || url.includes('.svg')) {
      throw e;
    } else {
      throw new Error(
        `Failed to download file from "${url}". Error: ${getCacheClientErrorMessage(e)}`,
      );
    }
  }
}

function isErrorUrlCacheActive(url: string): boolean {
  const cachedAt = errorUrlCache[url];
  if (cachedAt == null) {
    return false;
  }
  if (Date.now() - cachedAt >= BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS) {
    delete errorUrlCache[url];
    return false;
  }
  return true;
}

/**
 * 在数据下载与缓存层中确保DirectoryExists。
 *
 * @param filepath - filepath参数。
 */
function ensureDirectoryExists(filepath: string) {
  if (!fs.existsSync(filepath)) {
    try {
      fs.mkdirSync(filepath, { recursive: true });
    } catch {}
  }
}

/**
 * 在数据下载与缓存层中获取JSONAndSave。
 *
 * @param url - 远端资源地址。
 * @param directory - directory参数，未传入时使用默认值。
 * @param fileName - file名称参数，未传入时使用默认值。
 * @param cacheTime - 缓存时间参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function getJsonAndSave(
  url: string,
  directory?: string,
  fileName?: string,
  cacheTime = 0,
): Promise<object> {
  try {
    if (directory != undefined && fileName != undefined) {
      ensureDirectoryExists(directory);
    }
    let eTag: string | undefined;
    const cacheFilePath = path.join(directory || '', `${fileName || ''}`);
    if (fileName && directory) {
      const eTagFilePath = path.join(directory, `${fileName}.etag`);
      eTag = fs.existsSync(eTagFilePath)
        ? fs.readFileSync(eTagFilePath, 'utf-8')
        : undefined;
      if (fs.existsSync(cacheFilePath)) {
        const stat = fs.statSync(cacheFilePath);
        const now = Date.now();
        if (now - stat.mtimeMs < cacheTime * 1000) {
          const cachedData = fs.readFileSync(cacheFilePath, 'utf-8');
          const cachedJson = JSON.parse(cachedData);
          return cachedJson;
        }
      }
    }
    const headers = eTag ? { 'If-None-Match': eTag } : {};
    let response;
    try {
      response = await axios.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: getRequestTimeoutMs(),
      });
    } catch (error) {
      if (error.response && error.response.status === 304) {
        const cachedData = fs.readFileSync(cacheFilePath, 'utf-8');
        const cachedJson = JSON.parse(cachedData);
        return cachedJson;
      } else {
        throw error;
      }
    }

    const fileBuffer = Buffer.from(response.data, 'binary');
    const fileContent = fileBuffer.toString('utf-8');
    const jsonObject = JSON.parse(fileContent);

    const newETag = response.headers.etag;
    if (newETag && directory && fileName) {
      fs.writeFileSync(path.join(directory, `${fileName}.etag`), newETag);
    }

    if (directory && fileName) {
      fs.writeFileSync(path.join(directory, fileName), fileContent);
    }

    return jsonObject;
  } catch (e) {
    throw e;
    //throw new Error(`Failed to download JSON data from "${url}". Error: ${e.message}`);
  }
}
