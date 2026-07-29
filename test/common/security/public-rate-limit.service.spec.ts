import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ClientIpService } from '../../../src/common/security/client-ip.service';
import { PublicRateLimitService } from '../../../src/common/security/public-rate-limit.service';
import { RedisRateLimitStore } from '../../../src/common/security/redis-rate-limit.store';

function createRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
) {
  return {
    headers: {
      host: 'nas4.kwitsukasa.top:45231',
      ...headers,
    },
    method,
    originalUrl: path,
    path,
    socket: {
      remoteAddress: '203.0.113.11',
    },
    url: path,
  } as unknown as Request;
}

function createConfig(overrides: Record<string, unknown> = {}) {
  return new ConfigService({
    NODE_ENV: 'test',
    PUBLIC_RATE_LIMIT_BASELINE_LIMIT: 100,
    PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT: 100,
    PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS: 60000,
    PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT: 5,
    PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS: 60000,
    PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT: 10,
    PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS: 900000,
    PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS: 120000,
    PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT: 8,
    PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT: 10,
    PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS: 60000,
    PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT: 3,
    PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT: 30,
    PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS: 60000,
    PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX: 'kt:public-rate-limit',
    PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS: 30000,
    PUBLIC_RATE_LIMIT_WINDOW_MS: 60000,
    PUBLIC_SECURITY_SWAGGER_ALLOWLIST: '192.0.2.10',
    PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1',
    ...overrides,
  });
}

function createService(
  options: {
    config?: Record<string, unknown>;
    increment?: jest.Mock;
    incrementMany?: jest.Mock;
    acquireLease?: jest.Mock;
    deleteCounter?: jest.Mock;
    releaseLease?: jest.Mock;
    renewLease?: jest.Mock;
  } = {},
) {
  const config = createConfig(options.config);
  const clientIpService = new ClientIpService(config);
  const increment =
    options.increment ||
    jest.fn().mockResolvedValue({
      count: 1,
      ttlMs: 60000,
    });
  const incrementMany =
    options.incrementMany ||
    jest.fn().mockImplementation((buckets) =>
      Promise.resolve(
        buckets.map((bucket) => ({
          count: 1,
          ttlMs: bucket.ttlMs,
        })),
      ),
    );
  const store = {
    acquireLease:
      options.acquireLease ||
      jest.fn().mockResolvedValue({
        acquired: true,
        count: 1,
        ttlMs: 120000,
      }),
    deleteCounter: options.deleteCounter || jest.fn().mockResolvedValue(1),
    increment,
    incrementMany,
    releaseLease: options.releaseLease || jest.fn().mockResolvedValue(0),
    renewLease: options.renewLease || jest.fn().mockResolvedValue(true),
  } as unknown as RedisRateLimitStore;
  return {
    acquireLease: (store as any).acquireLease,
    deleteCounter: (store as any).deleteCounter,
    increment,
    incrementMany,
    releaseLease: (store as any).releaseLease,
    renewLease: (store as any).renewLease,
    service: new PublicRateLimitService(config, clientIpService, store),
  };
}

describe('RedisRateLimitStore', () => {
  it('uses one Lua call with a deterministic prefixed key and TTL', async () => {
    const evalMock = jest.fn().mockResolvedValue([2, 58765]);
    const store = new RedisRateLimitStore(
      { eval: evalMock } as never,
      createConfig(),
    );

    await expect(
      store.increment('public-read:read', 'identity-hash', 60000),
    ).resolves.toEqual({
      count: 2,
      ttlMs: 58765,
    });
    expect(store.buildKey('public-read:read', 'identity-hash')).toBe(
      'kt:public-rate-limit:public-read:read:identity-hash',
    );
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][1]).toBe(1);
    expect(evalMock.mock.calls[0][2]).toBe(
      'kt:public-rate-limit:public-read:read:identity-hash',
    );
    expect(evalMock.mock.calls[0][3]).toBe(60000);
  });

  it('increments all login dimensions atomically in one Lua call', async () => {
    const evalMock = jest
      .fn()
      .mockResolvedValue([2, 59000, 3, 899000, 70, 58000]);
    const store = new RedisRateLimitStore(
      { eval: evalMock } as never,
      createConfig(),
    );

    await expect(
      store.incrementMany([
        { identity: 'ip-hash', namespace: 'login:ip', ttlMs: 60000 },
        {
          identity: 'username-hash',
          namespace: 'login:username',
          ttlMs: 900000,
        },
        { identity: 'all', namespace: 'login:global', ttlMs: 60000 },
      ]),
    ).resolves.toEqual([
      { count: 2, ttlMs: 59000 },
      { count: 3, ttlMs: 899000 },
      { count: 70, ttlMs: 58000 },
    ]);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][1]).toBe(3);
    expect(evalMock.mock.calls[0].slice(2, 5)).toEqual([
      'kt:public-rate-limit:login:ip:ip-hash',
      'kt:public-rate-limit:login:username:username-hash',
      'kt:public-rate-limit:login:global:all',
    ]);
    expect(evalMock.mock.calls[0].slice(5)).toEqual([60000, 900000, 60000]);
  });

  it('deletes only the exact normalized username failure bucket', async () => {
    const delMock = jest.fn().mockResolvedValue(1);
    const store = new RedisRateLimitStore(
      { del: delMock } as never,
      createConfig(),
    );

    await expect(
      store.deleteCounter('login:username', 'username-hash'),
    ).resolves.toBe(1);
    expect(delMock).toHaveBeenCalledWith(
      'kt:public-rate-limit:login:username:username-hash',
    );
  });

  it('uses a token-fenced ZSET for acquire, renewal, and exact release', async () => {
    const evalMock = jest
      .fn()
      .mockResolvedValueOnce([1, 2, 120000])
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const store = new RedisRateLimitStore(
      { eval: evalMock } as never,
      createConfig(),
    );

    await expect(
      store.acquireLease(
        'live2d:concurrent',
        'ip-hash',
        'lease-old',
        3,
        120000,
      ),
    ).resolves.toEqual({
      acquired: true,
      count: 2,
      ttlMs: 120000,
    });
    await expect(
      store.renewLease('live2d:concurrent', 'ip-hash', 'lease-old', 120000),
    ).resolves.toBe(true);
    await expect(
      store.releaseLease('live2d:concurrent', 'ip-hash', 'lease-old'),
    ).resolves.toBe(true);
    expect(evalMock.mock.calls[0].slice(1)).toEqual([
      1,
      'kt:public-rate-limit:live2d:concurrent:ip-hash',
      'lease-old',
      3,
      120000,
    ]);
    expect(evalMock.mock.calls[0][0]).toEqual(
      expect.stringContaining('ZREMRANGEBYSCORE'),
    );
    expect(evalMock.mock.calls[0][0]).toEqual(
      expect.stringContaining('redis.call("TIME")'),
    );
    expect(evalMock.mock.calls[0][0]).toEqual(expect.stringContaining('ZADD'));
    expect(evalMock.mock.calls[0][0]).not.toContain('DECR');
    expect(evalMock.mock.calls[1][0]).toEqual(
      expect.stringContaining('redis.call("TIME")'),
    );
    expect(evalMock.mock.calls[1][0]).toEqual(
      expect.stringContaining('ZREMRANGEBYSCORE'),
    );
    expect(evalMock.mock.calls[2].slice(1)).toEqual([
      1,
      'kt:public-rate-limit:live2d:concurrent:ip-hash',
      'lease-old',
    ]);
  });

  it('rejects a delayed renewal after the Redis lease score has expired', async () => {
    const evalMock = jest.fn().mockResolvedValue(0);
    const store = new RedisRateLimitStore(
      { eval: evalMock } as never,
      createConfig(),
    );

    await expect(
      store.renewLease('live2d:concurrent', 'ip-hash', 'lease-old', 120000),
    ).resolves.toBe(false);

    const renewScript = String(evalMock.mock.calls[0][0]);
    expect(renewScript).toContain('redis.call("TIME")');
    expect(renewScript).toContain('ZREMRANGEBYSCORE');
    expect(renewScript.indexOf('ZREMRANGEBYSCORE')).toBeLessThan(
      renewScript.indexOf('ZSCORE'),
    );
  });

  it('cannot let an expired old lease release a new lease generation', async () => {
    const evalMock = jest
      .fn()
      .mockResolvedValueOnce([1, 1, 120000])
      .mockResolvedValueOnce([1, 1, 120000])
      .mockResolvedValueOnce(0);
    const store = new RedisRateLimitStore(
      { eval: evalMock } as never,
      createConfig(),
    );

    await store.acquireLease(
      'live2d:concurrent',
      'ip-hash',
      'lease-old',
      1,
      120000,
    );
    await store.acquireLease(
      'live2d:concurrent',
      'ip-hash',
      'lease-new',
      1,
      120000,
    );
    await expect(
      store.releaseLease('live2d:concurrent', 'ip-hash', 'lease-old'),
    ).resolves.toBe(false);

    expect(evalMock.mock.calls[1]).toContain('lease-new');
    expect(evalMock.mock.calls[2]).toContain('lease-old');
    expect(evalMock.mock.calls[2]).not.toContain('lease-new');
  });
});

describe('PublicRateLimitService', () => {
  it.each([
    ['GET', '/blog/article/public/list', 'public-read'],
    ['GET', '/blog/theme/config', 'public-read'],
    ['GET', '/blog/live2d/pio/catalog.json', 'public-read'],
    ['GET', '/wordpress/article/public/list', 'public-read'],
    ['GET', '/wordpress/theme/config', 'public-read'],
    ['POST', '/auth/login', 'login'],
    ['POST', '/auth/refresh', 'login'],
    ['POST', '/auth/logout', 'login'],
    ['GET', '/health/runtime', 'health'],
    ['GET', '/api', 'management'],
    ['GET', '/api-json', 'management'],
    ['GET', '/doc.html', 'management'],
    ['GET', '/services.json', 'management'],
    ['GET', '/system/menu/list', 'baseline'],
  ])('classifies %s %s as %s', (method, path, expected) => {
    const { service } = createService();

    expect(service.classify(createRequest(method, path))).toBe(expected);
  });

  it('classifies explicit public metadata as a public read fallback', () => {
    const { service } = createService();

    expect(
      service.classify(createRequest('GET', '/future/public'), {
        explicitlyPublic: true,
      }),
    ).toBe('public-read');
  });

  it.each([
    ['GET', '/system/network/events/stream', { accept: 'text/event-stream' }],
    ['GET', '/qqbot/account/scan/events', { accept: 'text/event-stream' }],
    [
      'GET',
      '/qqbot/onebot/reverse',
      { connection: 'Upgrade', upgrade: 'websocket' },
    ],
    ['POST', '/minio/upload', {}],
    ['POST', '/qqbot/plugin-platform/upload', {}],
  ])(
    'does not count the explicit exception %s %s',
    async (method, path, headers) => {
      const { increment, service } = createService();

      await expect(
        service.consume(createRequest(method, path, headers)),
      ).resolves.toMatchObject({
        allowed: true,
        policy: 'exception',
      });
      expect(increment).not.toHaveBeenCalled();
    },
  );

  it('does not let forged Upgrade headers bypass the login policy', async () => {
    const { incrementMany, service } = createService();

    const loginRequest = createRequest('POST', '/auth/login', {
      connection: 'Upgrade',
      upgrade: 'websocket',
    });
    loginRequest.body = { username: 'admin' };
    await expect(service.consume(loginRequest)).resolves.toMatchObject({
      allowed: true,
      policy: 'login',
    });
    expect(incrementMany).toHaveBeenCalledTimes(1);
  });

  it('does not let a forged event-stream Accept header bypass a public read', async () => {
    const { increment, service } = createService();

    await expect(
      service.consume(
        createRequest('GET', '/blog/article/public/events/stream', {
          accept: 'text/event-stream',
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      policy: 'public-read',
    });
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it('shares a deterministic bucket between HEAD and GET', async () => {
    const { increment, service } = createService();

    await service.consume(createRequest('GET', '/blog/article/public/list'));
    await service.consume(createRequest('HEAD', '/blog/article/public/list'));

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment.mock.calls[0]).toEqual(increment.mock.calls[1]);
  });

  it('returns 429 and a coarse Retry-After after the limit', async () => {
    const { service } = createService({
      increment: jest.fn().mockResolvedValue({ count: 4, ttlMs: 42100 }),
    });

    await expect(
      service.consume(createRequest('GET', '/blog/article/public/list')),
    ).resolves.toMatchObject({
      allowed: false,
      policy: 'public-read',
      retryAfterSeconds: 43,
      statusCode: 429,
    });
  });

  it('fails open for public reads when Redis is unavailable', async () => {
    const { service } = createService({
      increment: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(
      service.consume(createRequest('GET', '/blog/article/public/list')),
    ).resolves.toMatchObject({
      allowed: true,
      policy: 'public-read',
      redisAvailable: false,
    });
  });

  it('fails closed for login when Redis is unavailable', async () => {
    const { service } = createService({
      incrementMany: jest
        .fn()
        .mockRejectedValue(new Error('redis unavailable')),
    });

    const loginRequest = createRequest('POST', '/auth/login');
    loginRequest.body = { username: 'admin' };
    await expect(service.consume(loginRequest)).resolves.toMatchObject({
      allowed: false,
      policy: 'login',
      redisAvailable: false,
      statusCode: 503,
    });
  });

  it('throttles Redis outage warning logs', async () => {
    const { service } = createService({
      increment: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    });
    const warning = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(100000).mockReturnValueOnce(100001);

    await service.consume(createRequest('GET', '/blog/theme/config'));
    await service.consume(createRequest('GET', '/blog/theme/config'));

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0].join(' ')).not.toContain('redis unavailable');
    now.mockRestore();
  });

  it('allows production Swagger only for an exact management client IP', async () => {
    const { increment, service } = createService({
      config: {
        NODE_ENV: 'production',
        PUBLIC_SECURITY_SWAGGER_ALLOWLIST: '192.0.2.10',
      },
    });

    await expect(
      service.consume(createRequest('GET', '/api')),
    ).resolves.toMatchObject({
      allowed: false,
      policy: 'management',
      statusCode: 403,
    });
    expect(increment).not.toHaveBeenCalled();
  });

  it('rejects empty or malformed production security configuration', () => {
    expect(() =>
      createService({
        config: {
          NODE_ENV: 'production',
          PUBLIC_SECURITY_SWAGGER_ALLOWLIST: '',
        },
      }),
    ).toThrow('PUBLIC_SECURITY_SWAGGER_ALLOWLIST');
    expect(() =>
      createService({
        config: {
          PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX: 'invalid prefix',
        },
      }),
    ).toThrow('PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX');
    expect(() =>
      createService({
        config: {
          PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT: 0,
        },
      }),
    ).toThrow('PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT');
  });

  it.each(['192.0.2.0/24', '*', 'management.example.test'])(
    'rejects a non-exact Swagger management allowlist entry: %s',
    (value) => {
      expect(() =>
        createService({
          config: {
            PUBLIC_SECURITY_SWAGGER_ALLOWLIST: value,
          },
        }),
      ).toThrow('PUBLIC_SECURITY_SWAGGER_ALLOWLIST');
    },
  );

  it('uses atomic IP, normalized username hash, and global buckets for login', async () => {
    const { incrementMany, service } = createService();
    const firstRequest = createRequest('POST', '/auth/login');
    firstRequest.body = { username: '  Ａdmin  ' };
    const secondRequest = createRequest('POST', '/auth/login');
    secondRequest.body = { username: 'admin' };

    await service.consume(firstRequest);
    await service.consume(secondRequest);

    expect(incrementMany).toHaveBeenCalledTimes(2);
    const firstBuckets = incrementMany.mock.calls[0][0];
    const secondBuckets = incrementMany.mock.calls[1][0];
    expect(firstBuckets.map((bucket) => bucket.namespace)).toEqual([
      'login:ip',
      'login:username',
      'login:global',
    ]);
    expect(firstBuckets[1].identity).toBe(secondBuckets[1].identity);
    expect(firstBuckets[1].identity).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(firstBuckets)).not.toContain('admin');
    expect(firstBuckets.map((bucket) => bucket.ttlMs)).toEqual([
      60000, 900000, 60000,
    ]);
  });

  it('clears only the normalized username bucket after successful authentication', async () => {
    const { deleteCounter, service } = createService();

    await service.clearSuccessfulLoginUsername('  Ａdmin  ');

    expect(deleteCounter).toHaveBeenCalledWith(
      'login:username',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(deleteCounter.mock.calls)).not.toContain('admin');
  });

  it('fails closed when successful-login username cleanup cannot reach Redis', async () => {
    const { service } = createService({
      deleteCounter: jest
        .fn()
        .mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(
      service.clearSuccessfulLoginUsername('admin'),
    ).rejects.toMatchObject({
      status: 503,
    });
  });

  it.each([
    ['refresh', 'auth:refresh:subject'],
    ['logout', 'auth:logout:subject'],
  ] as const)(
    'limits a verified %s token by an irreversible subject bucket',
    async (operation, namespace) => {
      const { increment, service } = createService();

      await service.consumeVerifiedTokenSubject(operation, 'user-42');

      expect(increment).toHaveBeenCalledWith(
        namespace,
        expect.stringMatching(/^[a-f0-9]{64}$/),
        60000,
      );
      expect(JSON.stringify(increment.mock.calls)).not.toContain('user-42');
    },
  );

  it('rejects a verified refresh subject after its independent limit', async () => {
    const response = {
      setHeader: jest.fn(),
    };
    const { service } = createService({
      config: {
        PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT: 2,
      },
      increment: jest.fn().mockResolvedValue({ count: 3, ttlMs: 42100 }),
    });

    await expect(
      service.consumeVerifiedTokenSubject(
        'refresh',
        'user-42',
        response as never,
      ),
    ).rejects.toMatchObject({
      response: '请求过于频繁，请稍后重试',
      status: 429,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '43');
  });

  it('binds one Redis Live2D lease to finish/close/error with idempotent release', async () => {
    const response = new EventEmitter();
    response.on('error', () => undefined);
    const { acquireLease, releaseLease, service } = createService();

    await service.bindLive2DConcurrentLease(
      createRequest('GET', '/blog/live2d/pio/catalog.json'),
      response as never,
    );
    response.emit('finish');
    response.emit('close');
    response.emit('error', new Error('ignored after finish'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(acquireLease).toHaveBeenCalledWith(
      'live2d:concurrent',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{32}$/),
      8,
      120000,
    );
    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(releaseLease.mock.calls[0][2]).toBe(acquireLease.mock.calls[0][2]);
  });

  it('releases a lease acquired after the client has already disconnected', async () => {
    let resolveAcquire:
      | ((lease: { acquired: boolean; count: number; ttlMs: number }) => void)
      | undefined;
    const acquireLease = jest.fn(
      () =>
        new Promise<{ acquired: boolean; count: number; ttlMs: number }>(
          (resolve) => {
            resolveAcquire = resolve;
          },
        ),
    );
    const response = new EventEmitter();
    const { releaseLease, renewLease, service } = createService({
      acquireLease,
    });

    const binding = service.bindLive2DConcurrentLease(
      createRequest('GET', '/blog/live2d/pio/catalog.json'),
      response as never,
    );
    response.emit('close');
    resolveAcquire?.({
      acquired: true,
      count: 1,
      ttlMs: 120000,
    });

    try {
      await binding;
      await new Promise((resolve) => setImmediate(resolve));

      const acquireArguments = acquireLease.mock.calls[0] as unknown[];
      expect(releaseLease).toHaveBeenCalledTimes(1);
      expect(releaseLease).toHaveBeenCalledWith(
        'live2d:concurrent',
        acquireArguments[1],
        acquireArguments[2],
      );
      expect(renewLease).not.toHaveBeenCalled();
      expect(response.listenerCount('finish')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
      expect(response.listenerCount('error')).toBe(0);
    } finally {
      response.emit('close');
    }
  });

  it('renews a long-running Live2D stream with the same lease token', async () => {
    jest.useFakeTimers();
    try {
      const response = new EventEmitter();
      const { acquireLease, releaseLease, renewLease, service } =
        createService();

      await service.bindLive2DConcurrentLease(
        createRequest('GET', '/blog/live2d/pio/moc/index.json'),
        response as never,
      );
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(renewLease).toHaveBeenCalledWith(
        'live2d:concurrent',
        acquireLease.mock.calls[0][1],
        acquireLease.mock.calls[0][2],
        120000,
      );

      response.emit('close');
      await Promise.resolve();
      expect(releaseLease).toHaveBeenCalledWith(
        'live2d:concurrent',
        acquireLease.mock.calls[0][1],
        acquireLease.mock.calls[0][2],
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns 429 when the Redis Live2D concurrency lease is full', async () => {
    const { releaseLease, service } = createService({
      acquireLease: jest.fn().mockResolvedValue({
        acquired: false,
        count: 8,
        ttlMs: 90000,
      }),
    });

    await expect(
      service.bindLive2DConcurrentLease(
        createRequest('GET', '/blog/live2d/pio/catalog.json'),
        new EventEmitter() as never,
      ),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('fails open for Live2D concurrency when Redis is unavailable', async () => {
    const response = new EventEmitter();
    const { releaseLease, service } = createService({
      acquireLease: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(
      service.bindLive2DConcurrentLease(
        createRequest('GET', '/blog/live2d/pio/catalog.json'),
        response as never,
      ),
    ).resolves.toBeUndefined();
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it.each([
    ['login:ip', 6, 59000],
    ['login:username', 11, 899000],
    ['login:global', 101, 58000],
  ])(
    'rejects login when the %s dimension exceeds its limit',
    async (targetNamespace, count, ttlMs) => {
      const incrementMany = jest.fn().mockImplementation((buckets) =>
        Promise.resolve(
          buckets.map((bucket) => ({
            count: bucket.namespace === targetNamespace ? count : 1,
            ttlMs: bucket.namespace === targetNamespace ? ttlMs : bucket.ttlMs,
          })),
        ),
      );
      const { service } = createService({ incrementMany });
      const loginRequest = createRequest('POST', '/auth/login');
      loginRequest.body = { username: 'admin' };

      await expect(service.consume(loginRequest)).resolves.toMatchObject({
        allowed: false,
        policy: 'login',
        retryAfterSeconds: Math.ceil(ttlMs / 1000),
        statusCode: 429,
      });
    },
  );
});
