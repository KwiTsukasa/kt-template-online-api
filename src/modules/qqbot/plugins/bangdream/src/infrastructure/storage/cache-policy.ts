export const BANGDREAM_CACHE_RETRY_DELAY_MS = 3000;
export const BANGDREAM_MISSING_URL_CACHE_EXPIRY_MS = 12 * 60 * 60 * 1000;

export interface CacheClientRetryOptions<T> {
  action: (attempt: number) => Promise<T>;
  delayMs?: number;
  onFailure?: (attempt: number, retryCount: number, error: unknown) => void;
  onRetry?: (nextAttempt: number, retryCount: number, error: unknown) => void;
  retryCount?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * 根据参数 `error`，获取缓存客户端错误文本。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 根据参数 `error`，获取缓存客户端错误文本。
 */
export function getCacheClientErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 根据参数 `error`，获取缓存客户端 HTTP 错误状态码。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 根据参数 `error`，获取缓存客户端 HTTP 错误状态码；没有可用结果或提前结束时为 `undefined`。
 */
export function getCacheClientResponseStatus(
  error: unknown,
): number | undefined {
  if (typeof error !== 'object' || error == null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status;
}

/**
 * 仅把状态码为 HTTP 404 的缓存客户端错误识别为资源未命中。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 满足仅把状态码为 HTTP 404 的缓存客户端错误识别为资源未命中约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isCacheClientNotFound(error: unknown): boolean {
  return getCacheClientResponseStatus(error) === 404;
}

/**
 * 将`retryCount`规范为缓存客户端重试次数，使等价输入得到一致表示。
 * @param retryCount - 限制缓存客户端重试次数数量、尺寸、等级或重试边界的数值；省略时默认采用 `1`。
 * @returns 缓存客户端重试次数。
 */
export function normalizeCacheClientRetryCount(retryCount = 1): number {
  return Math.max(1, retryCount);
}

/**
 * 通过等待缓存客户端下一次重试。
 * @param delayMs - 用于通过等待缓存客户端下一次重试超时、有效期或退避计算的毫秒数。
 */
export async function waitCacheClientRetryDelay(
  delayMs: number,
): Promise<void> {
  if (delayMs <= 0) return;
  await sleepBangDreamRuntime(delayMs);
}

/**
 * 按缓存客户端策略执行可重试任务。
 * @param options - 控制按缓存客户端策略执行可重试任务筛选、缓存或输出方式的可选项，包含 `retryCount`、`delayMs`、`action`、`onFailure` 字段。
 * @returns 按缓存客户端策略执行可重试任务。
 * @throws 当 `attempt >= retryCount || !canRetry` 成立时重新抛出该入口捕获且决定公开的原异常；当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `lastError`。
 */
export async function runWithCacheClientRetry<T>(
  options: CacheClientRetryOptions<T>,
): Promise<T> {
  const retryCount = normalizeCacheClientRetryCount(options.retryCount);
  const delayMs = options.delayMs ?? BANGDREAM_CACHE_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      return await options.action(attempt);
    } catch (error) {
      lastError = error;
      options.onFailure?.(attempt, retryCount, error);
      const canRetry = options.shouldRetry?.(error, attempt) ?? true;
      if (attempt >= retryCount || !canRetry) {
        throw error;
      }
      options.onRetry?.(attempt + 1, retryCount, error);
      await waitCacheClientRetryDelay(delayMs);
    }
  }

  throw lastError;
}
import { sleepBangDreamRuntime } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
