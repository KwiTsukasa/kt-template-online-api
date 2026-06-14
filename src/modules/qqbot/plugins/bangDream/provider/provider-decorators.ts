import { logger } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-logger';
import type {
  BangDreamAssetRequestOptions,
  BangDreamDataProvider,
  BangDreamJsonRequestOptions,
  BangDreamTrackerRequestOptions,
} from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';

type ProviderMethodName = 'getJson' | 'getAsset' | 'getTracker';

export interface BangDreamProviderRetryOptions {
  delayMs?: number;
  retryCount?: number;
}

export interface BangDreamProviderTimingOptions {
  methods?: ProviderMethodName[];
}

export interface BangDreamProviderCacheOptions {
  jsonCacheTime?: number;
  trackerCacheTime?: number;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryCount(
  defaultRetryCount: number,
  requestRetryCount?: number,
): number {
  const retryCount = requestRetryCount ?? defaultRetryCount;
  return Math.max(1, retryCount);
}

async function retryProviderCall<T>(
  providerName: string,
  methodName: ProviderMethodName,
  retryCount: number,
  delayMs: number,
  action: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) {
        break;
      }
      logger(
        'BangDreamDataProvider',
        `${providerName}.${methodName} retry ${attempt + 1}/${retryCount}: ${String(error)}`,
      );
      await delay(delayMs);
    }
  }
  throw lastError;
}

function shouldTimeMethod(
  methodName: ProviderMethodName,
  options?: BangDreamProviderTimingOptions,
): boolean {
  return (options?.methods ?? ['getJson', 'getTracker']).includes(methodName);
}

function withRequestRetryCount<T extends BangDreamJsonRequestOptions>(
  options: T | undefined,
): T {
  return { ...options, retryCount: 1 } as T;
}

export function withRetry(
  provider: BangDreamDataProvider,
  options: BangDreamProviderRetryOptions = {},
): BangDreamDataProvider {
  const defaultRetryCount = options.retryCount ?? 1;
  const delayMs = options.delayMs ?? 0;
  return {
    ...provider,
    getJson: <T = unknown>(
      pathOrUrl: string,
      requestOptions?: BangDreamJsonRequestOptions,
    ) =>
      retryProviderCall(
        provider.name,
        'getJson',
        getRetryCount(defaultRetryCount, requestOptions?.retryCount),
        delayMs,
        () =>
          provider.getJson<T>(pathOrUrl, withRequestRetryCount(requestOptions)),
      ),
    getAsset: (
      pathOrUrl: string,
      requestOptions?: BangDreamAssetRequestOptions,
    ) =>
      retryProviderCall(
        provider.name,
        'getAsset',
        getRetryCount(defaultRetryCount, requestOptions?.retryCount),
        delayMs,
        () =>
          provider.getAsset(pathOrUrl, {
            ...requestOptions,
            retryCount: 1,
          }),
      ),
    getTracker: <T = unknown>(requestOptions: BangDreamTrackerRequestOptions) =>
      retryProviderCall(
        provider.name,
        'getTracker',
        getRetryCount(defaultRetryCount, requestOptions.retryCount),
        delayMs,
        () => provider.getTracker<T>(withRequestRetryCount(requestOptions)),
      ),
  };
}

export function withTiming(
  provider: BangDreamDataProvider,
  options: BangDreamProviderTimingOptions = {},
): BangDreamDataProvider {
  const runTimed = async <T>(
    methodName: ProviderMethodName,
    target: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    if (!shouldTimeMethod(methodName, options)) {
      return action();
    }
    const startedAt = Date.now();
    try {
      const result = await action();
      logger(
        'BangDreamDataProvider',
        `${provider.name}.${methodName} ${Date.now() - startedAt}ms ${target}`,
      );
      return result;
    } catch (error) {
      logger(
        'BangDreamDataProvider',
        `${provider.name}.${methodName} failed ${Date.now() - startedAt}ms ${target}: ${String(error)}`,
      );
      throw error;
    }
  };
  return {
    ...provider,
    getJson: <T = unknown>(
      pathOrUrl: string,
      requestOptions?: BangDreamJsonRequestOptions,
    ) =>
      runTimed('getJson', pathOrUrl, () =>
        provider.getJson<T>(pathOrUrl, requestOptions),
      ),
    getAsset: (
      pathOrUrl: string,
      requestOptions?: BangDreamAssetRequestOptions,
    ) =>
      runTimed('getAsset', pathOrUrl, () =>
        provider.getAsset(pathOrUrl, requestOptions),
      ),
    getTracker: <T = unknown>(requestOptions: BangDreamTrackerRequestOptions) =>
      runTimed(
        'getTracker',
        `${requestOptions.server}/${requestOptions.eventId}/${requestOptions.tier}`,
        () => provider.getTracker<T>(requestOptions),
      ),
  };
}

export function withCache(
  provider: BangDreamDataProvider,
  options: BangDreamProviderCacheOptions = {},
): BangDreamDataProvider {
  return {
    ...provider,
    getJson: <T = unknown>(
      pathOrUrl: string,
      requestOptions?: BangDreamJsonRequestOptions,
    ) =>
      provider.getJson<T>(pathOrUrl, {
        ...requestOptions,
        cacheTime: requestOptions?.cacheTime ?? options.jsonCacheTime,
      }),
    getTracker: <T = unknown>(requestOptions: BangDreamTrackerRequestOptions) =>
      provider.getTracker<T>({
        ...requestOptions,
        cacheTime: requestOptions.cacheTime ?? options.trackerCacheTime,
      }),
  };
}
