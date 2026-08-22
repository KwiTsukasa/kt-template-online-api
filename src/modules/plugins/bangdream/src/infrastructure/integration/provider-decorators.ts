import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import type {
  BangDreamAssetRequestOptions,
  BangDreamDataProvider,
  BangDreamJsonRequestOptions,
  BangDreamTrackerRequestOptions,
} from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { sleepBangDreamRuntime } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

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
 * 根据`ms`处理对正毫秒数调用 BanG Dream 运行时休眠；当 `ms <= 0` 成立时直接结束且不产生返回值。
 * @param ms - 决定对正毫秒数调用 BanG Dream 运行时休眠内容、边界或目标的 `ms` 值。
 */
async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await sleepBangDreamRuntime(ms);
}

/**
 * 优先使用请求级重试次数，未提供时使用默认次数，并将最终值下限限制为 `1`。
 * @param defaultRetryCount - 限制数量、尺寸、等级或重试边界的数值。
 * @param requestRetryCount - 限制数量、尺寸、等级或重试边界的数值；为空时采用 `defaultRetryCount` 作为兜底。
 * @returns 数量。
 */
function getRetryCount(
  defaultRetryCount: number,
  requestRetryCount?: number,
): number {
  const retryCount = requestRetryCount ?? defaultRetryCount;
  return Math.max(1, retryCount);
}

/**
 * 根据`providerName`、`methodName`、`retryCount`处理数据提供器调用。
 * @param providerName - 决定数据提供器调用内容、边界或目标的 `providerName` 值。
 * @param methodName - 决定数据提供器调用内容、边界或目标的 `methodName` 值。
 * @param retryCount - 限制数据提供器调用数量、尺寸、等级或重试边界的数值。
 * @param delayMs - 用于数据提供器调用超时、有效期或退避计算的毫秒数。
 * @param action - 负责完成数据提供器调用外部交互的受控能力。
 * @returns 数据提供器调用。
 * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `lastError`。
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
 * 根据配置的方法白名单判断是否记录 Provider 耗时；未配置时仅包含 `getJson` 和 `getTracker`。
 * @param methodName - 决定根据配置的方法白名单判断是否记录 Provider 耗时内容、边界或目标的 `methodName` 值。
 * @param options - 控制根据配置的方法白名单判断是否记录 Provider 耗时筛选、缓存或输出方式的可选项，包含 `methods` 字段；为空时采用 `['getJson', 'getTracker']` 作为兜底。
 * @returns 满足根据配置的方法白名单判断是否记录 Provider 耗时约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function shouldTimeMethod(
  methodName: ProviderMethodName,
  options?: BangDreamProviderTimingOptions,
): boolean {
  return (options?.methods ?? ['getJson', 'getTracker']).includes(methodName);
}

/**
 * 根据`options`处理包含 `retryCount` 字段的结果。
 * @param options - 控制包含 `retryCount` 字段的结果筛选、缓存或输出方式的可选项。
 * @returns 包含 `retryCount` 字段的包含 `retryCount` 字段的。
 */
function withRequestRetryCount<T extends BangDreamJsonRequestOptions>(
  options: T | undefined,
): T {
  return { ...options, retryCount: 1 } as T;
}

/**
 * 根据`provider`、`options`处理包含 `getJson`、`getAsset`、`getTracker` 字段的结果。
 * @param provider - 用于包含 `getJson`、`getAsset`、`getTracker` 字段的结果的领域对象，包含 `name`、`getJson`、`getAsset`、`getTracker` 字段。
 * @param options - 控制包含 `getJson`、`getAsset`、`getTracker` 字段的结果筛选、缓存或输出方式的可选项，包含 `retryCount`、`delayMs` 字段；省略时默认采用 `{}`。
 * @returns 包含 `getJson`、`getAsset`、`getTracker` 字段的`withRetry` 对应结果。
 */
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

/**
 * 根据`provider`、`options`处理包含 `getJson`、`getAsset`、`getTracker` 字段的结果。
 * @param provider - 用于包含 `getJson`、`getAsset`、`getTracker` 字段的结果的领域对象，包含 `name`、`getJson`、`getAsset`、`getTracker` 字段。
 * @param options - 控制包含 `getJson`、`getAsset`、`getTracker` 字段的结果筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
 * @returns 包含 `getJson`、`getAsset`、`getTracker` 字段的Timing。
 */
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

/**
 * 根据`provider`、`options`处理包含 `getJson`、`getTracker` 字段的结果。
 * @param provider - 用于包含 `getJson`、`getTracker` 字段的结果的领域对象，包含 `getJson`、`getTracker` 字段。
 * @param options - 控制包含 `getJson`、`getTracker` 字段的结果筛选、缓存或输出方式的可选项，包含 `jsonCacheTime`、`trackerCacheTime` 字段；省略时默认采用 `{}`。
 * @returns 包含 `getJson`、`getTracker` 字段的包含 `getJson`、`getTracker` 字段的。
 */
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
