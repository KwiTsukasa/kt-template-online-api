import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  readBangDreamRuntimeConfig,
  requestBangDreamArrayBuffer,
  requestBangDreamJson,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
import {
  BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS,
  getCacheClientErrorMessage,
  getCacheClientResponseStatus,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-policy';

const errorUrlCache: Record<string, number> = {};
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

/**
 * 查询 BangDream 插件数据。
 * @returns BangDream 插件查询结果。
 */
function getRequestTimeoutMs(): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.requestTimeoutMs),
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * 判断 BangDream 插件条件。
 * @param url - 访问地址；计算 BangDream判断结果。
 * @returns 布尔值，表示 BangDream 插件条件是否满足。
 */
function isErrorUrlCacheActive(url: string): boolean {
  const cachedAt = errorUrlCache[url];
  if (cachedAt == null) return false;
  if (Date.now() - cachedAt >= BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS) {
    delete errorUrlCache[url];
    return false;
  }
  return true;
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；影响 rememberNotFound 的返回值。
 * @param statusCode - statusCode 输入；决定 BangDream条件分支。
 */
function rememberNotFound(url: string, statusCode?: number) {
  if (statusCode === 404) errorUrlCache[url] = Date.now();
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；驱动 `Error()`、`requestBangDreamArrayBuffer()`、`rememberNotFound()` 的 BangDream步骤。
 * @param _directory - _directory 输入；影响 fetchRemoteResourceBuffer 的返回值。
 * @param _fileName - _fileName 输入；影响 fetchRemoteResourceBuffer 的返回值。
 * @param _cacheTime - _cacheTime 输入；影响 fetchRemoteResourceBuffer 的返回值。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
export async function fetchRemoteResourceBuffer(
  url: string,
  _directory?: string,
  _fileName?: string,
  _cacheTime?: number,
): Promise<Buffer> {
  void _directory;
  void _fileName;
  void _cacheTime;
  if (isErrorUrlCacheActive(url)) {
    throw new Error('downloadFile: errorUrlCache includes url');
  }

  try {
    const response = await requestBangDreamArrayBuffer(url, {
      timeoutMs: getRequestTimeoutMs(),
    });
    rememberNotFound(url, response.statusCode);
    if ((response.statusCode || 200) >= 400) {
      throw new Error(`Failed to download file from "${url}".`);
    }
    return response.body;
  } catch (error) {
    rememberNotFound(url, getCacheClientResponseStatus(error));
    throw new Error(
      `Failed to download file from "${url}". Error: ${getCacheClientErrorMessage(error)}`,
    );
  }
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；驱动 `Error()`、`rememberNotFound()` 的 BangDream步骤。
 * @param _directory - _directory 输入；影响 fetchRemoteResourceJson 的返回值。
 * @param _fileName - _fileName 输入；影响 fetchRemoteResourceJson 的返回值。
 * @param _cacheTime - _cacheTime 输入；影响 fetchRemoteResourceJson 的返回值。
 * @returns 异步完成后的 BangDream 插件结果。
 */
export async function fetchRemoteResourceJson<T = object>(
  url: string,
  _directory?: string,
  _fileName?: string,
  _cacheTime?: number,
): Promise<T> {
  void _directory;
  void _fileName;
  void _cacheTime;
  if (isErrorUrlCacheActive(url)) {
    throw new Error('downloadFile: errorUrlCache includes url');
  }

  const response = await requestBangDreamJson<T>(url, {
    timeoutMs: getRequestTimeoutMs(),
  });
  rememberNotFound(url, response.statusCode);
  if ((response.statusCode || 200) >= 400) {
    throw new Error(`Failed to download JSON data from "${url}".`);
  }
  return response.body;
}
