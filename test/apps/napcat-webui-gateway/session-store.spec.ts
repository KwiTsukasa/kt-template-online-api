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
});
