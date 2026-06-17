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
 * 解析Bang Dream Provider Url。
 * @param baseUrl - 访问地址；生成规范化文本。
 * @param pathOrUrl - BangDream路径；计算 BangDream布尔判断。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
export function resolveBangDreamProviderUrl(
  baseUrl: string,
  pathOrUrl: string,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = pathOrUrl.startsWith('/')
    ? pathOrUrl
    : `/${pathOrUrl}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}
