import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import type {
  BangDreamAssetRequestOptions,
  BangDreamDataProvider,
  BangDreamJsonRequestOptions,
  BangDreamTrackerRequestOptions,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { sleepBangDreamRuntime } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

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

/**
 * 执行 BangDream 插件流程。
 * @param ms - 等待毫秒数；驱动 `sleepBangDreamRuntime()` 的 BangDream步骤。
 */
async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await sleepBangDreamRuntime(ms);
}

/**
 * 查询 BangDream 插件数据。
 * @param defaultRetryCount - defaultRetryCount 输入；限定 BangDream查询范围。
 * @param requestRetryCount - requestRetryCount 输入；限定 BangDream查询范围。
 * @returns BangDream 插件查询结果。
 */
function getRetryCount(
  defaultRetryCount: number,
  requestRetryCount?: number,
): number {
  const retryCount = requestRetryCount ?? defaultRetryCount;
  return Math.max(1, retryCount);
}

/**
 * 执行 BangDream 插件流程。
 * @param providerName - providerName 输入；影响 retryProviderCall 的返回值。
 * @param methodName - methodName 输入；影响 retryProviderCall 的返回值。
 * @param retryCount - retryCount 输入；决定 BangDream条件分支。
 * @param delayMs - BangDream列表；驱动 `delay()` 的 BangDream步骤。
 * @param action - action 输入；影响 retryProviderCall 的返回值。
 * @returns 异步完成后的 BangDream 插件结果。
 */
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

/**
 * 判断 BangDream 插件条件。
 * @param methodName - methodName 输入；计算 BangDream判断结果。
 * @param options - BangDream列表；计算 BangDream判断结果。
 * @returns 布尔值，表示 BangDream 插件条件是否满足。
 */
function shouldTimeMethod(
  methodName: ProviderMethodName,
  options?: BangDreamProviderTimingOptions,
): boolean {
  return (options?.methods ?? ['getJson', 'getTracker']).includes(methodName);
}

/**
 * 执行 BangDream 插件流程。
 * @param options - BangDream列表；影响 withRequestRetryCount 的返回值。
 * @returns BangDream 插件产出的 T。
 */
function withRequestRetryCount<T extends BangDreamJsonRequestOptions>(
  options: T | undefined,
): T {
  return { ...options, retryCount: 1 } as T;
}

/**
 * 执行 BangDream 插件流程。
 * @param provider - provider 输入；使用 `name`、`getJson`、`getTracker` 字段生成结果。
 * @param options - BangDream列表；使用 `retryCount`、`delayMs` 字段生成结果。
 * @returns BangDream 插件产出的 BangDreamDataProvider。
 */
export function withRetry(
  provider: BangDreamDataProvider,
  options: BangDreamProviderRetryOptions = {},
): BangDreamDataProvider {
  const defaultRetryCount = options.retryCount ?? 1;
  const delayMs = options.delayMs ?? 0;
  return {
    ...provider,
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `retryProviderCall()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；驱动 `retryProviderCall()` 的 BangDream步骤。
     */
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
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `retryProviderCall()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；驱动 `retryProviderCall()` 的 BangDream步骤。
     */
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
    /**
     * 读取 BangDream回调数据。
     * @param requestOptions - BangDream列表；使用 `retryCount` 字段生成结果。
     */
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

/**
 * 执行 BangDream 插件流程。
 * @param provider - provider 输入；使用 `name`、`getJson`、`getTracker` 字段生成结果。
 * @param options - BangDream列表；决定 BangDream条件分支。
 * @returns BangDream 插件产出的 BangDreamDataProvider。
 */
export function withTiming(
  provider: BangDreamDataProvider,
  options: BangDreamProviderTimingOptions = {},
): BangDreamDataProvider {
  /**
   * 执行 BangDream 插件步骤。
   * @param methodName - methodName 输入；决定 BangDream条件分支。
   * @param target - target 输入；影响 runTimed 的返回值。
   * @param action - action 输入；影响 runTimed 的返回值。
   * @returns BangDream 插件产出的 Promise<T>。
   */
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
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `runTimed()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；驱动 `runTimed()` 的 BangDream步骤。
     */
    getJson: <T = unknown>(
      pathOrUrl: string,
      requestOptions?: BangDreamJsonRequestOptions,
    ) =>
      runTimed('getJson', pathOrUrl, () =>
        provider.getJson<T>(pathOrUrl, requestOptions),
      ),
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；驱动 `runTimed()` 的 BangDream步骤。
     * @param requestOptions - BangDream列表；驱动 `runTimed()` 的 BangDream步骤。
     */
    getAsset: (
      pathOrUrl: string,
      requestOptions?: BangDreamAssetRequestOptions,
    ) =>
      runTimed('getAsset', pathOrUrl, () =>
        provider.getAsset(pathOrUrl, requestOptions),
      ),
    /**
     * 读取 BangDream回调数据。
     * @param requestOptions - BangDream列表；使用 `server`、`eventId`、`tier` 字段生成结果。
     */
    getTracker: <T = unknown>(requestOptions: BangDreamTrackerRequestOptions) =>
      runTimed(
        'getTracker',
        `${requestOptions.server}/${requestOptions.eventId}/${requestOptions.tier}`,
        () => provider.getTracker<T>(requestOptions),
      ),
  };
}

/**
 * 执行 BangDream 插件流程。
 * @param provider - provider 输入；使用 `getJson`、`getTracker` 字段生成结果。
 * @param options - BangDream列表；使用 `jsonCacheTime`、`trackerCacheTime` 字段生成结果。
 * @returns BangDream 插件产出的 BangDreamDataProvider。
 */
export function withCache(
  provider: BangDreamDataProvider,
  options: BangDreamProviderCacheOptions = {},
): BangDreamDataProvider {
  return {
    ...provider,
    /**
     * 读取 BangDream回调数据。
     * @param pathOrUrl - BangDream路径；限定 BangDream查询范围。
     * @param requestOptions - BangDream列表；限定 BangDream查询范围。
     */
    getJson: <T = unknown>(
      pathOrUrl: string,
      requestOptions?: BangDreamJsonRequestOptions,
    ) =>
      provider.getJson<T>(pathOrUrl, {
        ...requestOptions,
        cacheTime: requestOptions?.cacheTime ?? options.jsonCacheTime,
      }),
    /**
     * 读取 BangDream回调数据。
     * @param requestOptions - BangDream列表；使用 `cacheTime` 字段生成结果。
     */
    getTracker: <T = unknown>(requestOptions: BangDreamTrackerRequestOptions) =>
      provider.getTracker<T>({
        ...requestOptions,
        cacheTime: requestOptions.cacheTime ?? options.trackerCacheTime,
      }),
  };
}
