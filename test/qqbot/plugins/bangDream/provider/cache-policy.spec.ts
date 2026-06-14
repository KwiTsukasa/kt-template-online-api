import {
  getCacheClientErrorMessage,
  getCacheClientResponseStatus,
  isCacheClientNotFound,
  normalizeCacheClientRetryCount,
  runWithCacheClientRetry,
} from '@/modules/qqbot/plugins/bangDream/provider/cache-policy';

describe('BangDream cache client policy', () => {
  it('normalizes retry count and reads http status safely', () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });

    expect(normalizeCacheClientRetryCount(0)).toBe(1);
    expect(normalizeCacheClientRetryCount(3)).toBe(3);
    expect(getCacheClientResponseStatus(notFoundError)).toBe(404);
    expect(isCacheClientNotFound(notFoundError)).toBe(true);
    expect(getCacheClientErrorMessage(notFoundError)).toBe('not found');
    expect(getCacheClientResponseStatus('plain')).toBeUndefined();
  });

  it('retries transient failures with a bounded retry count', async () => {
    const action = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();

    await expect(
      runWithCacheClientRetry({
        action,
        delayMs: 0,
        onRetry,
        retryCount: 2,
      }),
    ).resolves.toBe('ok');

    expect(action).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      2,
      2,
      expect.objectContaining({ message: 'temporary' }),
    );
  });

  it('does not retry when the caller marks the error as non-retryable', async () => {
    const action = jest.fn().mockRejectedValue(new Error('missing'));

    await expect(
      runWithCacheClientRetry({
        action,
        delayMs: 0,
        retryCount: 3,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('missing');

    expect(action).toHaveBeenCalledTimes(1);
  });
});
