export interface BangDreamJsonRequestOptions {
  cacheTime?: number;
  retryCount?: number;
}

export interface BangDreamAssetRequestOptions {
  ignoreError?: boolean;
  memoryCache?: boolean;
  overwrite?: boolean;
  retryCount?: number;
}

export interface BangDreamTrackerRequestOptions extends BangDreamJsonRequestOptions {
  eventId: number;
  server: number;
  tier: number;
}

export interface BangDreamDataProvider {
  name: string;
  resolveUrl(pathOrUrl: string): string;
  getJson<T = unknown>(
    pathOrUrl: string,
    options?: BangDreamJsonRequestOptions,
  ): Promise<T>;
  getAsset(
    pathOrUrl: string,
    options?: BangDreamAssetRequestOptions,
  ): Promise<Buffer>;
  getTracker<T = unknown>(options: BangDreamTrackerRequestOptions): Promise<T>;
}

/**
 * 从`baseUrl`、`pathOrUrl`解析BanG Dream数据提供器URL 地址；当 `/^https?:\/\//i.test(pathOrUrl)` 成立时返回 `pathOrUrl`。
 * @param baseUrl - 待规范化、请求或同源校验的baseURL 地址 URL。
 * @param pathOrUrl - 待规范化、请求或同源校验的路径URL 地址 URL。
 * @returns 按参数编码并拼接完成的BanGDream数据提供器URL 地址。
 */
export function resolveBangDreamProviderUrl(
  baseUrl: string,
  pathOrUrl: string,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = (() => {
    if (pathOrUrl.startsWith('/')) {
      return pathOrUrl;
    }
    return `/${pathOrUrl}`;
  })();
  return `${normalizedBaseUrl}${normalizedPath}`;
}
