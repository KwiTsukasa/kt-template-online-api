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
