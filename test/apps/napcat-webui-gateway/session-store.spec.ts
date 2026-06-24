import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { NapcatWebuiGatewaySessionService } from '../../../src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service';
import { NapcatWebuiGatewayConfigService } from '../../../src/apps/napcat-webui-gateway/config/napcat-webui-gateway-config.service';
import {
  NAPCAT_WEBUI_GATEWAY_SESSION_STORE,
  type NapcatWebuiGatewaySession,
  type NapcatWebuiGatewaySessionStore,
} from '../../../src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types';
import { NapcatWebuiGatewayRedisStore } from '../../../src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-redis.store';
import { NapcatWebuiGatewayTicketService } from '../../../src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service';
import { InternalSessionController } from '../../../src/apps/napcat-webui-gateway/presentation/internal-session.controller';

const INTERNAL_SECRET = ['internal', 'secret', 'fixture'].join('-');

class MemorySessionStore implements NapcatWebuiGatewaySessionStore {
  readonly sessions = new Map<string, NapcatWebuiGatewaySession>();

  /**
   * Stores a new in-memory session for service lifecycle tests.
   * @param session - Session object created by the Gateway session service.
   * @returns Stored session.
   */
  async create(session: NapcatWebuiGatewaySession) {
    this.sessions.set(session.sessionId, { ...session });
    return { ...session };
  }

  /**
   * Finds a session by id from the in-memory fixture store.
   * @param sessionId - Gateway session id.
   * @returns Matching session or undefined.
   */
  async find(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  /**
   * Finds the currently usable session for the Admin user and QQBot account pair.
   * @param adminUserId - Admin actor id.
   * @param accountId - QQBot account id.
   * @returns Existing non-terminal session or undefined.
   */
  async findActiveByUserAndAccount(adminUserId: string, accountId: string) {
    const session = [...this.sessions.values()].find(
      (item) =>
        item.adminUserId === adminUserId &&
        item.accountId === accountId &&
        !['expired', 'failed', 'revoked'].includes(item.status),
    );

    return session ? { ...session } : undefined;
  }

  /**
   * Applies a partial update to an existing test session.
   * @param sessionId - Gateway session id.
   * @param patch - Fields to merge into the stored session.
   * @returns Updated session.
   */
  async update(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ) {
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error(`Missing session ${sessionId}`);
    const next = { ...current, ...patch };
    this.sessions.set(sessionId, next);
    return { ...next };
  }
}

class FakeRedis {
  readonly calls: string[] = [];
  readonly values = new Map<string, string>();
  readonly ttl = new Map<string, number>();

  /**
   * Stores a value with an expiration marker for Redis-backed store tests.
   * @param key - Redis key.
   * @param ttlMs - Millisecond TTL.
   * @param value - Serialized value.
   * @returns Redis OK marker.
   */
  async psetex(key: string, ttlMs: number, value: string) {
    this.calls.push(`psetex:${key}:${ttlMs}`);
    this.values.set(key, value);
    this.ttl.set(key, ttlMs);
    return 'OK';
  }

  /**
   * Stores a string value with optional PX expiration arguments.
   * @param key - Redis key.
   * @param value - Serialized value.
   * @param mode - Optional Redis expiration mode.
   * @param ttlMs - Optional Redis TTL.
   * @returns Redis OK marker.
   */
  async set(key: string, value: string, mode?: string, ttlMs?: number) {
    this.calls.push(`set:${key}:${mode || ''}:${ttlMs || ''}`);
    this.values.set(key, value);
    if (mode === 'PX' && ttlMs) this.ttl.set(key, ttlMs);
    return 'OK';
  }

  /**
   * Reads a string value by key from the fake Redis store.
   * @param key - Redis key.
   * @returns Stored value or null.
   */
  async get(key: string) {
    this.calls.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  /**
   * Atomically reads and deletes one key from the fake Redis store.
   * @param key - Redis key to consume.
   * @returns Stored value before deletion or null.
   */
  async getdel(key: string) {
    this.calls.push(`getdel:${key}`);
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    this.ttl.delete(key);
    return value;
  }

  /**
   * Deletes one or more keys from the fake Redis store.
   * @param keys - Redis keys to delete.
   * @returns Number of deleted keys.
   */
  async del(...keys: string[]) {
    this.calls.push(`del:${keys.join(',')}`);
    let deleted = 0;
    keys.forEach((key) => {
      if (this.values.delete(key)) deleted += 1;
      this.ttl.delete(key);
    });
    return deleted;
  }

  /**
   * Simulates Gateway Redis Lua scripts used by ticket and session store tests.
   * @param script - Lua script text.
   * @param keyCount - Number of Redis keys in the script call.
   * @param args - Redis keys and script arguments after `keyCount`.
   * @returns Script-shaped response used by the store.
   */
  async eval(script: string, keyCount: number, ...args: string[]) {
    this.calls.push(`eval:${keyCount}:${args.join(':')}`);
    if (!script.includes('redis.call')) {
      throw new Error('Unexpected Redis script');
    }
    if (keyCount !== 1) {
      throw new Error('Unexpected Redis key count');
    }

    const [
      sessionKey,
      sessionId,
      patchJson,
      userAccountKeyPrefix,
      now,
    ] = args;
    const currentJson = this.values.get(sessionKey);
    if (!currentJson) return [0, 'Gateway session is not active'];

    const current = JSON.parse(currentJson) as NapcatWebuiGatewaySession;
    const patch = JSON.parse(
      patchJson,
    ) as Partial<NapcatWebuiGatewaySession>;
    const next = {
      ...current,
      ...patch,
      accountId: current.accountId,
      adminUserId: current.adminUserId,
      sessionId,
    } as NapcatWebuiGatewaySession;
    next.expiresAt = Math.max(current.expiresAt, patch.expiresAt || 0);
    if (current.lastSeenAt || patch.lastSeenAt) {
      next.lastSeenAt = Math.max(
        current.lastSeenAt || 0,
        patch.lastSeenAt || 0,
      );
    }
    if (current.activeAt) {
      next.activeAt = current.activeAt;
    }
    if (current.revokedAt) {
      next.revokedAt = current.revokedAt;
    }

    const terminalStatuses = ['expired', 'failed', 'revoked'];
    const currentTerminal = terminalStatuses.includes(current.status);
    const nextTerminal = terminalStatuses.includes(next.status);
    const indexKey = `${userAccountKeyPrefix}${current.adminUserId}:${current.accountId}`;
    const indexValue = this.values.get(indexKey);
    const ttlMs = Math.max(1, next.expiresAt - Number(now));
    const nextSessionJson = JSON.stringify(next);

    if (currentTerminal && !nextTerminal) {
      return [0, 'Gateway session is not active'];
    }

    if (nextTerminal) {
      this.values.set(sessionKey, nextSessionJson);
      this.ttl.set(sessionKey, ttlMs);
      if (indexValue === sessionId) {
        this.values.delete(indexKey);
        this.ttl.delete(indexKey);
      }
      return [1, nextSessionJson];
    }

    if (indexValue && indexValue !== sessionId) {
      return [0, 'Gateway session is not active'];
    }

    this.values.set(sessionKey, nextSessionJson);
    this.ttl.set(sessionKey, ttlMs);
    this.values.set(indexKey, sessionId);
    this.ttl.set(indexKey, ttlMs);
    return [1, nextSessionJson];
  }
}

/**
 * Creates a Gateway session creation input with safe server-only target data.
 * @param override - Fields to replace in the default fixture.
 * @returns Session creation payload.
 */
function createSessionInput(
  override: Partial<Parameters<NapcatWebuiGatewaySessionService['create']>[0]> = {},
) {
  return {
    accountId: 'account-1',
    adminUserId: 'admin-1',
    clientIp: '127.0.0.1',
    containerId: 'container-1',
    containerName: 'kt-qqbot-napcat-1914728559',
    selfId: '1914728559',
    upstreamBaseUrl: 'http://127.0.0.1:6099',
    userAgent: 'jest-agent',
    webuiToken: ['webui', 'token', 'fixture'].join('-'),
    ...override,
  };
}

/**
 * Creates a lightweight config fixture for Gateway service tests.
 * @param currentTime - Mutable time supplier used by lifecycle assertions.
 * @returns Config service shape consumed by Gateway services.
 */
function createConfig(currentTime: { value: number }) {
  return {
    internalSecret: () => INTERNAL_SECRET,
    now: () => currentTime.value,
    publicSessionPrefix: () => '/napcat-webui/session',
    ticketTtlMs: () => 60_000,
    ttlMs: () => 60_000,
  };
}

describe('NapcatWebuiGatewaySessionService', () => {
  it('revokes an older same-user same-account session when creating a new one', async () => {
    const store = new MemorySessionStore();
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig({ value: 1000 }) as never,
    );

    const first = await service.create(createSessionInput());
    const second = await service.create(createSessionInput());

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await store.find(first.sessionId)).toMatchObject({
      revokedAt: 1000,
      status: 'revoked',
    });
    expect(await store.find(second.sessionId)).toMatchObject({
      createdAt: 1000,
      expiresAt: 61_000,
      status: 'created',
    });
  });

  it('extends active sessions on heartbeat and rejects revoked sessions', async () => {
    const store = new MemorySessionStore();
    const currentTime = { value: 1000 };
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig(currentTime) as never,
    );
    const session = await service.create(createSessionInput());

    currentTime.value = 5000;
    await service.markActive(session.sessionId);
    const heartbeat = await service.heartbeat({
      adminUserId: 'admin-1',
      sessionId: session.sessionId,
    });

    expect(heartbeat).toEqual({
      expiresAt: 65_000,
      sessionId: session.sessionId,
      status: 'active',
    });
    expect(await store.find(session.sessionId)).toMatchObject({
      activeAt: 5000,
      expiresAt: 65_000,
      lastSeenAt: 5000,
      status: 'active',
    });

    await service.revoke({
      adminUserId: 'admin-1',
      sessionId: session.sessionId,
    });

    await expect(
      service.heartbeat({
        adminUserId: 'admin-1',
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow('Gateway session is not active');
  });

  it('does not allow terminal sessions to become active again', async () => {
    const store = new MemorySessionStore();
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig({ value: 1000 }) as never,
    );
    const session = await service.create(createSessionInput());

    await service.revoke({
      adminUserId: 'admin-1',
      sessionId: session.sessionId,
    });

    await expect(service.markActive(session.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
    await expect(
      service.heartbeat({
        adminUserId: 'admin-1',
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow('Gateway session is not active');
    expect(await store.find(session.sessionId)).toMatchObject({
      status: 'revoked',
    });
  });

  it('rejects blank required create fields and invalid upstream URLs', async () => {
    const store = new MemorySessionStore();
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig({ value: 1000 }) as never,
    );

    await expect(
      service.create(createSessionInput({ webuiToken: ' ' })),
    ).rejects.toThrow('Gateway session field webuiToken is required');
    await expect(
      service.create(createSessionInput({ upstreamBaseUrl: 'ftp://127.0.0.1' })),
    ).rejects.toThrow('Gateway session upstream URL is invalid');
    expect(store.sessions.size).toBe(0);
  });

  it('rejects heartbeat and revoke owner mismatches', async () => {
    const store = new MemorySessionStore();
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig({ value: 1000 }) as never,
    );
    const session = await service.create(createSessionInput());

    await expect(
      service.heartbeat({
        adminUserId: 'admin-2',
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow('Gateway session owner mismatch');
    await expect(
      service.revoke({
        adminUserId: 'admin-2',
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow('Gateway session owner mismatch');
  });

  it('keeps created sessions out of proxy access until bootstrap marks them active', async () => {
    const store = new MemorySessionStore();
    const currentTime = { value: 1000 };
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig(currentTime) as never,
    );
    const session = await service.create(createSessionInput());

    await expect(service.requireProxySession(session.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
    await expect(
      service.requireBootstrapSession(session.sessionId),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: 'created',
    });

    currentTime.value = 5000;
    await service.markActive(session.sessionId);

    await expect(
      service.requireProxySession(session.sessionId),
    ).resolves.toMatchObject({
      activeAt: 5000,
      sessionId: session.sessionId,
      status: 'active',
    });
  });

  it('rejects expired proxy sessions and marks them expired', async () => {
    const store = new MemorySessionStore();
    const currentTime = { value: 1000 };
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig(currentTime) as never,
    );
    const session = await service.create(createSessionInput());

    currentTime.value = 70_000;

    await expect(service.requireProxySession(session.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
    expect(await store.find(session.sessionId)).toMatchObject({
      status: 'expired',
    });
  });

  it('rejects revoked sessions for proxy access', async () => {
    const store = new MemorySessionStore();
    const service = new NapcatWebuiGatewaySessionService(
      store,
      createConfig({ value: 1000 }) as never,
    );
    const session = await service.create(createSessionInput());

    await service.revoke({
      adminUserId: 'admin-1',
      sessionId: session.sessionId,
    });

    await expect(service.requireProxySession(session.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
  });
});

describe('NapcatWebuiGatewayRedisStore', () => {
  it('stores sessions with remaining TTL and ignores terminal indexed sessions', async () => {
    const redis = new FakeRedis();
    const config = createConfig({ value: 1000 });
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const session: NapcatWebuiGatewaySession = {
      ...createSessionInput(),
      createdAt: 1000,
      expiresAt: 61_000,
      sessionId: 'session-1',
      status: 'created',
    };

    await store.create(session);
    await store.update(session.sessionId, {
      revokedAt: 2000,
      status: 'revoked',
    });

    expect(redis.ttl.get('napcat:webui:session:session-1')).toBe(60_000);
    await expect(
      store.findActiveByUserAndAccount('admin-1', 'account-1'),
    ).resolves.toBeUndefined();
  });

  it('keeps the newer user-account index when an older revoked session is revoked again', async () => {
    const redis = new FakeRedis();
    const config = createConfig({ value: 1000 });
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const service = new NapcatWebuiGatewaySessionService(
      store,
      config as never,
    );

    const first = await service.create(createSessionInput());
    const second = await service.create(createSessionInput());

    await expect(
      service.revoke({
        adminUserId: 'admin-1',
        sessionId: first.sessionId,
      }),
    ).rejects.toThrow('Gateway session is not active');
    await expect(
      store.findActiveByUserAndAccount('admin-1', 'account-1'),
    ).resolves.toMatchObject({
      sessionId: second.sessionId,
      status: 'created',
    });
    expect(redis.values.get('napcat:webui:user-account:admin-1:account-1')).toBe(
      second.sessionId,
    );
  });

  it('rejects stale non-terminal updates when the index points at a newer session', async () => {
    const redis = new FakeRedis();
    const config = createConfig({ value: 1000 });
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const service = new NapcatWebuiGatewaySessionService(
      store,
      config as never,
    );
    const first = await service.create(createSessionInput());
    const second = await service.create(createSessionInput());
    const firstSessionKey = `napcat:webui:session:${first.sessionId}`;
    const indexKey = 'napcat:webui:user-account:admin-1:account-1';

    redis.values.set(
      firstSessionKey,
      JSON.stringify({
        ...first,
        status: 'created',
      }),
    );
    redis.values.set(indexKey, second.sessionId);

    await expect(
      store.update(first.sessionId, {
        activeAt: 2000,
        expiresAt: 62_000,
        lastSeenAt: 2000,
        status: 'active',
      }),
    ).rejects.toThrow('Gateway session is not active');
    expect(redis.values.get(indexKey)).toBe(second.sessionId);
    expect(JSON.parse(redis.values.get(firstSessionKey) || '{}')).toMatchObject({
      status: 'created',
    });
  });

  it('keeps delayed old heartbeat and activation from reviving a replaced session', async () => {
    const redis = new FakeRedis();
    const currentTime = { value: 1000 };
    const config = createConfig(currentTime);
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const service = new NapcatWebuiGatewaySessionService(
      store,
      config as never,
    );
    const first = await service.create(createSessionInput());
    const second = await service.create(createSessionInput());

    currentTime.value = 2000;

    await expect(service.markActive(first.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
    await expect(
      service.heartbeat({
        adminUserId: 'admin-1',
        sessionId: first.sessionId,
      }),
    ).rejects.toThrow('Gateway session is not active');
    await expect(
      store.findActiveByUserAndAccount('admin-1', 'account-1'),
    ).resolves.toMatchObject({
      sessionId: second.sessionId,
    });
  });

  it('rejects stale replaced sessions from bootstrap and proxy loaders', async () => {
    const redis = new FakeRedis();
    const config = createConfig({ value: 1000 });
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const service = new NapcatWebuiGatewaySessionService(
      store,
      config as never,
    );
    const first = await service.create(createSessionInput());
    const second = await service.create(createSessionInput());
    const firstSessionKey = `napcat:webui:session:${first.sessionId}`;
    const indexKey = 'napcat:webui:user-account:admin-1:account-1';

    redis.values.set(
      firstSessionKey,
      JSON.stringify({
        ...first,
        status: 'created',
      }),
    );
    redis.values.set(indexKey, second.sessionId);

    await expect(
      service.requireBootstrapSession(first.sessionId),
    ).rejects.toThrow('Gateway session is not active');

    redis.values.set(
      firstSessionKey,
      JSON.stringify({
        ...first,
        activeAt: 2000,
        lastSeenAt: 2000,
        status: 'active',
      }),
    );

    await expect(service.requireProxySession(first.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
  });

  it('merges delayed lifecycle patches without reducing monotonic timestamps', async () => {
    const redis = new FakeRedis();
    const currentTime = { value: 1000 };
    const config = createConfig(currentTime);
    const store = new NapcatWebuiGatewayRedisStore(
      redis as never,
      config as never,
    );
    const service = new NapcatWebuiGatewaySessionService(
      store,
      config as never,
    );
    const session = await service.create(createSessionInput());

    currentTime.value = 5000;
    await service.markActive(session.sessionId);

    currentTime.value = 2000;
    const heartbeat = await service.heartbeat({
      adminUserId: 'admin-1',
      sessionId: session.sessionId,
    });
    const markActive = await service.markActive(session.sessionId);
    const stored = await store.find(session.sessionId);

    expect(heartbeat.expiresAt).toBe(65_000);
    expect(markActive).toMatchObject({
      activeAt: 5000,
      expiresAt: 65_000,
      lastSeenAt: 5000,
      status: 'active',
    });
    expect(stored).toMatchObject({
      activeAt: 5000,
      expiresAt: 65_000,
      lastSeenAt: 5000,
      status: 'active',
    });
  });
});

describe('NapcatWebuiGatewayTicketService', () => {
  it('redeems bootstrap tickets once and deletes them before returning', async () => {
    const redis = new FakeRedis();
    const service = new NapcatWebuiGatewayTicketService(
      redis as never,
      createConfig({ value: 1000 }) as never,
    );

    const ticket = await service.issue('session-1');
    const sessionId = await service.redeem(ticket);
    const secondRedeem = await service.redeem(ticket);

    expect(sessionId).toBe('session-1');
    expect(secondRedeem).toBeUndefined();
    const ticketKey = `napcat:webui:ticket:${ticket}`;
    const ticketCalls = redis.calls.filter((call) => call.includes(ticketKey));
    expect(redis.values.get(ticketKey)).toBeUndefined();
    expect(ticketCalls).toEqual([
      `set:${ticketKey}:PX:60000`,
      `getdel:${ticketKey}`,
      `getdel:${ticketKey}`,
    ]);
    expect(ticketCalls).not.toContain(`get:${ticketKey}`);
    expect(ticketCalls).not.toContain(`del:${ticketKey}`);
  });
});

describe('InternalSessionController', () => {
  let app: INestApplication;
  const store = new MemorySessionStore();
  const currentTime = { value: 1000 };
  const config = createConfig(currentTime);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalSessionController],
      providers: [
        NapcatWebuiGatewaySessionService,
        NapcatWebuiGatewayTicketService,
        {
          provide: NapcatWebuiGatewayConfigService,
          useValue: config,
        },
        {
          provide: NAPCAT_WEBUI_GATEWAY_SESSION_STORE,
          useValue: store,
        },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: new FakeRedis(),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    store.sessions.clear();
    currentTime.value = 1000;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a safe relative iframe URL with a bootstrap ticket', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send(createSessionInput())
      .expect(HttpStatus.CREATED);

    expect(response.body).toEqual({
      expiresAt: 61_000,
      iframeUrl: expect.stringMatching(
        /^\/napcat-webui\/session\/[0-9a-f-]+\/bootstrap\?ticket=[A-Za-z0-9_-]+$/,
      ),
      sessionId: expect.any(String),
    });
    expect(response.body.iframeUrl).not.toContain('http://');
    expect(response.body.iframeUrl).not.toContain('webui-token-fixture');
    expect(response.body.iframeUrl).not.toContain('127.0.0.1');
  });

  it('rejects missing or wrong secrets for all mutating calls', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions')
      .send(createSessionInput())
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', 'wrong-secret')
      .send(createSessionInput())
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .post('/internal/sessions/session-1/heartbeat')
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .post('/internal/sessions/session-1/heartbeat')
      .set('x-kt-gateway-secret', 'wrong-secret')
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .post('/internal/sessions/session-1/revoke')
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .post('/internal/sessions/session-1/revoke')
      .set('x-kt-gateway-secret', 'wrong-secret')
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.UNAUTHORIZED);
    await request(app.getHttpServer())
      .get('/internal/health')
      .expect(HttpStatus.OK);
  });

  it('returns lifecycle HTTP errors for missing, revoked, and owner mismatch sessions', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions/missing-session/heartbeat')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.GONE);

    const createResponse = await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send(createSessionInput())
      .expect(HttpStatus.CREATED);
    const sessionId = createResponse.body.sessionId;

    await request(app.getHttpServer())
      .post(`/internal/sessions/${sessionId}/heartbeat`)
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({ adminUserId: 'admin-2' })
      .expect(HttpStatus.FORBIDDEN);
    await request(app.getHttpServer())
      .post(`/internal/sessions/${sessionId}/revoke`)
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.CREATED);
    await request(app.getHttpServer())
      .post(`/internal/sessions/${sessionId}/heartbeat`)
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({ adminUserId: 'admin-1' })
      .expect(HttpStatus.GONE);
  });

  it('rejects blank lifecycle admin user ids with bad request status', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send(createSessionInput())
      .expect(HttpStatus.CREATED);
    const sessionId = createResponse.body.sessionId;

    await request(app.getHttpServer())
      .post(`/internal/sessions/${sessionId}/heartbeat`)
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({})
      .expect(HttpStatus.BAD_REQUEST);
    await request(app.getHttpServer())
      .post(`/internal/sessions/${sessionId}/revoke`)
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send({ adminUserId: ' ' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('rejects invalid create-session payloads with bad request status', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send(createSessionInput({ adminUserId: ' ' }))
      .expect(HttpStatus.BAD_REQUEST);
    await request(app.getHttpServer())
      .post('/internal/sessions')
      .set('x-kt-gateway-secret', INTERNAL_SECRET)
      .send(createSessionInput({ upstreamBaseUrl: 'not-a-url' }))
      .expect(HttpStatus.BAD_REQUEST);
  });
});
