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
 * 获取缓存客户端错误文本。
 *
 * @param error - 待解析错误。
 */
export function getCacheClientErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 获取缓存客户端 HTTP 错误状态码。
 *
 * @param error - 待解析错误。
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
 * 判断缓存客户端错误是否为 HTTP 404。
 *
 * @param error - 待判断错误。
 */
export function isCacheClientNotFound(error: unknown): boolean {
  return getCacheClientResponseStatus(error) === 404;
}

/**
 * 规范化缓存客户端重试次数。
 *
 * @param retryCount - 原始重试次数。
 */
export function normalizeCacheClientRetryCount(retryCount = 1): number {
  return Math.max(1, retryCount);
}

/**
 * 等待缓存客户端下一次重试。
 *
 * @param delayMs - 等待毫秒数。
 */
export async function waitCacheClientRetryDelay(
  delayMs: number,
): Promise<void> {
  if (delayMs <= 0) return;
  await sleepBangDreamRuntime(delayMs);
}

/**
 * 按缓存客户端策略执行可重试任务。
 *
 * @param options - 重试策略。
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
