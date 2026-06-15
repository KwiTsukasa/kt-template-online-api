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

function getRequestTimeoutMs(): number {
  const parsed = Number(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.requestTimeoutMs),
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function isErrorUrlCacheActive(url: string): boolean {
  const cachedAt = errorUrlCache[url];
  if (cachedAt == null) return false;
  if (Date.now() - cachedAt >= BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS) {
    delete errorUrlCache[url];
    return false;
  }
  return true;
}

function rememberNotFound(url: string, statusCode?: number) {
  if (statusCode === 404) errorUrlCache[url] = Date.now();
}

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
