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
 * 按当前运行态读取超时Ms；当 `Number.isFinite(parsed) && parsed > 0` 成立时返回 `Math.floor(parsed)`。
 * @returns 超时Ms。
 */
function getRequestTimeoutMs(): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.requestTimeoutMs),
  );
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * 根据 `true` 判定输入是否满足条件。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 满足根据 `true` 判定输入是否满足条件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 将本次操作写入 `errorUrlCache[url]` 状态。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param statusCode - 决定rememberNotFound内容、边界或目标的 `statusCode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 */
function rememberNotFound(url: string, statusCode?: number) {
  if (statusCode === 404) errorUrlCache[url] = Date.now();
}

/**
 * 通过 `isErrorUrlCacheActive` 判断输入是否满足函数约束。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param _directory - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param _fileName - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param _cacheTime - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 远端Resource缓冲区。
 * @throws 当 `isErrorUrlCacheActive(url)` 成立时拒绝当前输入并抛出 `Error`；当 `(response.statusCode || 200) >= 400` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `requestBangDreamArrayBuffer` 或 `getRequestTimeoutMs` 调用失败时拒绝当前输入并抛出 `Error`。
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
 * 通过 `isErrorUrlCacheActive` 判断输入是否满足函数约束。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param _directory - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param _fileName - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param _cacheTime - 为兼容既有调用签名保留的参数，当前实现不会读取该值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 远端ResourceJSON 数据。
 * @throws 当 `isErrorUrlCacheActive(url)` 成立时拒绝当前输入并抛出 `Error`；当 `(response.statusCode || 200) >= 400` 成立时拒绝当前输入并抛出 `Error`。
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
