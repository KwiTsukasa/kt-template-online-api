import { ConfigService } from '@nestjs/config';
import { AdminRefreshTokenStateStore } from '../../../src/modules/admin/identity/auth/infrastructure/persistence/admin-refresh-token-state.store';

describe('AdminRefreshTokenStateStore', () => {
  const config = new ConfigService({
    PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX: 'kt:public-rate-limit',
  });

  it('creates one independent session family with an expiring Redis key', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const store = new AdminRefreshTokenStateStore({ set } as never, config);

    await expect(
      store.createSession('a'.repeat(32), 2_592_000_000),
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(
      `kt:public-rate-limit:auth:refresh:family:${'a'.repeat(32)}`,
      'active',
      'PX',
      2_592_000_000,
      'NX',
    );
  });

  it('atomically rejects a revoked family or a reused token id', async () => {
    const evalRedis = jest.fn().mockResolvedValue(1);
    const store = new AdminRefreshTokenStateStore(
      { eval: evalRedis } as never,
      config,
    );

    await expect(
      store.rotateSession({
        currentTokenTtlMs: 3_600_000,
        nextTokenTtlMs: 2_592_000_000,
        sessionId: 'a'.repeat(32),
        tokenId: 'b'.repeat(32),
      }),
    ).resolves.toBe(true);

    expect(evalRedis.mock.calls[0].slice(1)).toEqual([
      2,
      `kt:public-rate-limit:auth:refresh:family:${'a'.repeat(32)}`,
      `kt:public-rate-limit:auth:refresh:used:${'a'.repeat(32)}:${'b'.repeat(32)}`,
      3_600_000,
      2_592_000_000,
    ]);
    expect(evalRedis.mock.calls[0][0]).toEqual(
      expect.stringContaining('redis.call("GET", KEYS[1])'),
    );
    expect(evalRedis.mock.calls[0][0]).toEqual(expect.stringContaining('"NX"'));
  });

  it('revokes the entire session family while preserving its longest TTL', async () => {
    const evalRedis = jest.fn().mockResolvedValue(1);
    const store = new AdminRefreshTokenStateStore(
      { eval: evalRedis } as never,
      config,
    );

    await expect(store.revokeSession('a'.repeat(32), 3_600_000)).resolves.toBe(
      true,
    );
    expect(evalRedis.mock.calls[0].slice(1)).toEqual([
      1,
      `kt:public-rate-limit:auth:refresh:family:${'a'.repeat(32)}`,
      3_600_000,
    ]);
    expect(evalRedis.mock.calls[0][0]).toEqual(
      expect.stringContaining('"revoked"'),
    );
    expect(evalRedis.mock.calls[0][0]).toEqual(expect.stringContaining('PTTL'));
  });
});
