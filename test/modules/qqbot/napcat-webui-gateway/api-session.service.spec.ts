import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HttpException, HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getMetadataArgsStorage } from 'typeorm';
import * as request from 'supertest';
import axios from 'axios';
import {
  QqbotNapcatWebuiGatewayService,
  NapcatWebuiGatewayAuditService,
} from '../../../../src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service';
import { QqbotNapcatWebuiGatewayController } from '../../../../src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller';
import { QqbotNapcatWebuiGatewayClient } from '../../../../src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client';
import { NapcatWebuiGatewayAudit } from '../../../../src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import {
  NAPCAT_RUNTIME_DOMAIN_CONTRACT,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat/infrastructure/persistence';

jest.mock('axios');

const repoRoot = resolve(__dirname, '../../../..');
const requestMock = axios.request as jest.Mock;
const EXPIRES_AT_FIXTURE = 1782268000000;
const INTERNAL_SECRET_FIXTURE = ['internal', 'secret'].join('-');
const WEBUI_PERMISSION = 'QqBot:Account:WebUI';
const WEBUI_TOKEN_FIXTURE = ['webui', 'token', 'fixture'].join('-');

type TestAdminRole = {
  isDeleted?: boolean;
  menus?: Array<{
    authCode?: null | string;
    isDeleted?: boolean;
    status?: number;
  }>;
  roleCode: string;
  status?: number;
};

type TestAdminUser = {
  id: string;
  roles: TestAdminRole[];
};

type MockRepository<T extends object> = {
  create: jest.Mock<T, [Partial<T>]>;
  rows: T[];
  save: jest.Mock<Promise<T>, [T]>;
};

/**
 * Reads a source or SQL file from the API repository root.
 * @param relativePath - Repository-relative file path.
 * @returns File text used by schema and contract assertions.
 */
const readSource = (relativePath: string) => {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
};

/**
 * Creates the minimal TypeORM repository mock needed by audit recording tests.
 * @returns Repository-like object that stores saved rows for assertions.
 */
const createRepository = <T extends object>() => {
  const rows: T[] = [];
  const repository: MockRepository<T> = {
    create: jest.fn((input: Partial<T>) => ({ ...input }) as T),
    rows,
    save: jest.fn(async (input: T) => {
      rows.push(input);
      return input;
    }),
  };

  return repository;
};

/**
 * Creates a minimal Admin user shape consumed by `@CurrentAdminUser()`.
 * @param roles - Roles and menu auth codes to attach to the test user.
 * @returns Admin user-like object for controller tests.
 */
const createAdminUser = (roles: TestAdminRole[]): TestAdminUser => ({
  id: '3001',
  roles,
});

/**
 * Creates a reusable browser-safe session result for controller tests.
 * @returns Safe Gateway session payload returned by the mocked service.
 */
const createSafeSessionResponse = () => ({
  account: {
    id: '1001',
    name: '主机器人',
    selfId: '1914728559',
  },
  container: {
    webuiStatus: 'online',
  },
  expiresAt: EXPIRES_AT_FIXTURE,
  iframeUrl: '/napcat-webui/session/sess_1/bootstrap?ticket=bootstrap-ticket-1',
  sessionId: 'sess_1',
});

/**
 * Extracts a readable message from Vben-style HTTP exceptions.
 * @param error - Error thrown by the service under test.
 * @returns Vben `msg` or regular error message.
 */
const getThrownMessage = (error: unknown) => {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { msg?: string };
    return response.msg;
  }
  return error instanceof Error ? error.message : String(error);
};

describe('QqbotNapcatWebuiGatewayController', () => {
  let app: INestApplication;
  let currentAdminUser: TestAdminUser;
  const gatewayService = {
    createSession: jest.fn(),
    heartbeat: jest.fn(),
    revoke: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotNapcatWebuiGatewayController],
      providers: [
        {
          provide: QqbotNapcatWebuiGatewayService,
          useValue: gatewayService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        /**
         * Supplies a request-scoped Admin user while bypassing JWT parsing.
         * @param context - Nest execution context for the current HTTP request.
         * @returns Always true so controller-level authorization can be tested.
         */
        canActivate: (context) => {
          context.switchToHttp().getRequest().adminUser = currentAdminUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    currentAdminUser = createAdminUser([
      {
        menus: [{ authCode: WEBUI_PERMISSION, status: 1 }],
        roleCode: 'operator',
        status: 1,
      },
    ]);
    gatewayService.createSession.mockResolvedValue(createSafeSessionResponse());
    gatewayService.heartbeat.mockResolvedValue({ ok: true, status: 'active' });
    gatewayService.revoke.mockResolvedValue({ ok: true, status: 'revoked' });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('denies non-super Admin users without WebUI permission', async () => {
    currentAdminUser = createAdminUser([
      {
        menus: [{ authCode: 'QqBot:Account:List', status: 1 }],
        roleCode: 'operator',
        status: 1,
      },
    ]);

    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session')
      .send({ accountId: '1001' })
      .expect(HttpStatus.FORBIDDEN);

    expect(gatewayService.createSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      'deleted role',
      [
        {
          isDeleted: true,
          menus: [{ authCode: WEBUI_PERMISSION, status: 1 }],
          roleCode: 'operator',
          status: 1,
        },
      ],
    ],
    [
      'inactive role',
      [
        {
          menus: [{ authCode: WEBUI_PERMISSION, status: 1 }],
          roleCode: 'operator',
          status: 0,
        },
      ],
    ],
    [
      'deleted menu',
      [
        {
          menus: [
            {
              authCode: WEBUI_PERMISSION,
              isDeleted: true,
              status: 1,
            },
          ],
          roleCode: 'operator',
          status: 1,
        },
      ],
    ],
    [
      'inactive menu',
      [
        {
          menus: [{ authCode: WEBUI_PERMISSION, status: 0 }],
          roleCode: 'operator',
          status: 1,
        },
      ],
    ],
  ])('denies WebUI access for %s', async (_case, roles) => {
    currentAdminUser = createAdminUser(roles);

    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session')
      .send({ accountId: '1001' })
      .expect(HttpStatus.FORBIDDEN);

    expect(gatewayService.createSession).not.toHaveBeenCalled();
  });

  it('allows Admin users with WebUI permission and passes create-session evidence', async () => {
    const response = await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session')
      .set('user-agent', 'controller-agent')
      .send({ accountId: '1001' })
      .expect(HttpStatus.OK);

    expect(response.body.data).toEqual(createSafeSessionResponse());
    expect(gatewayService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '1001',
        adminUserId: '3001',
        clientIp: expect.any(String),
        userAgent: 'controller-agent',
      }),
    );
  });

  it('allows active super role as a WebUI permission bypass', async () => {
    currentAdminUser = createAdminUser([
      {
        menus: [],
        roleCode: 'super',
        status: 1,
      },
    ]);

    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session')
      .send({ accountId: '1001' })
      .expect(HttpStatus.OK);

    expect(gatewayService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '1001',
        adminUserId: '3001',
      }),
    );
  });

  it('passes heartbeat and revoke ownership evidence to the service', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session/sess_1/heartbeat')
      .set('user-agent', 'controller-agent')
      .expect(HttpStatus.OK);
    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session/sess_1/revoke')
      .set('user-agent', 'controller-agent')
      .expect(HttpStatus.OK);

    expect(gatewayService.heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: '3001',
        clientIp: expect.any(String),
        sessionId: 'sess_1',
        userAgent: 'controller-agent',
      }),
    );
    expect(gatewayService.revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: '3001',
        clientIp: expect.any(String),
        sessionId: 'sess_1',
        userAgent: 'controller-agent',
      }),
    );
  });

  it('rejects malformed account and session identifiers before service calls', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session')
      .send({ accountId: ' ' })
      .expect(HttpStatus.BAD_REQUEST);
    await request(app.getHttpServer())
      .post('/qqbot/napcat/webui/session/bad%20session/heartbeat')
      .expect(HttpStatus.BAD_REQUEST);

    expect(gatewayService.createSession).not.toHaveBeenCalled();
    expect(gatewayService.heartbeat).not.toHaveBeenCalled();
  });
});

describe('QqbotNapcatWebuiGatewayService', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('creates a browser-safe Gateway session and records sanitized audit', async () => {
    const account = {
      id: '1001',
      name: '主机器人',
      selfId: '1914728559',
    };
    const runtime = {
      baseUrl: 'http://172.18.0.23:6099',
      id: '2001',
      name: 'kt-qqbot-napcat-1914728559',
      sourceContainerOnline: true,
      webuiPort: 6099,
      webuiToken: WEBUI_TOKEN_FIXTURE,
    };
    const gatewayResult = {
      expiresAt: EXPIRES_AT_FIXTURE,
      iframeUrl:
        '/napcat-webui/session/sess_1/bootstrap?ticket=bootstrap-ticket-1',
      sessionId: 'sess_1',
    };
    const accountService = {
      findById: jest.fn(async () => account),
    };
    const containerService = {
      findPrimaryContainerByAccountId: jest.fn(async () => runtime),
    };
    const client = {
      createSession: jest.fn(async () => gatewayResult),
    };
    const auditRepository = createRepository<NapcatWebuiGatewayAudit>();
    const audit = new NapcatWebuiGatewayAuditService(
      auditRepository as never,
    );
    const service = new QqbotNapcatWebuiGatewayService(
      accountService as never,
      containerService as never,
      client as unknown as QqbotNapcatWebuiGatewayClient,
      audit,
    );

    const response = await service.createSession({
      accountId: '1001',
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      userAgent: 'jest-agent',
    });
    const serialized = JSON.stringify(response);
    const savedAudit = auditRepository.rows[0];
    const serializedAudit = JSON.stringify(savedAudit);

    expect(response).toEqual({
      account: {
        id: '1001',
        name: '主机器人',
        selfId: '1914728559',
      },
      container: {
        webuiStatus: 'online',
      },
      expiresAt: EXPIRES_AT_FIXTURE,
      iframeUrl:
        '/napcat-webui/session/sess_1/bootstrap?ticket=bootstrap-ticket-1',
      sessionId: 'sess_1',
    });
    expect(client.createSession).toHaveBeenCalledWith({
      accountId: '1001',
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      containerId: '2001',
      containerName: 'kt-qqbot-napcat-1914728559',
      selfId: '1914728559',
      upstreamBaseUrl: 'http://172.18.0.23:6099',
      userAgent: 'jest-agent',
      webuiToken: WEBUI_TOKEN_FIXTURE,
    });
    expect(serialized).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(serialized).not.toContain('Credential');
    expect(serialized).not.toContain('2001');
    expect(serialized).not.toContain('kt-qqbot-napcat-1914728559');
    expect(serialized).not.toContain('172.18.0.23');
    expect(serialized).not.toContain('6099');
    expect(serialized).not.toContain(INTERNAL_SECRET_FIXTURE);

    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '1001',
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        containerId: '2001',
        eventType: 'session.create',
        selfId: '1914728559',
        sessionId: 'sess_1',
        userAgent: 'jest-agent',
      }),
    );
    expect(savedAudit.detailJson).toEqual({
      accountName: '主机器人',
      containerName: 'kt-qqbot-napcat-1914728559',
      webuiStatus: 'online',
    });
    expect(serializedAudit).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(serializedAudit).not.toContain('Credential');
    expect(serializedAudit).not.toContain('bootstrap-ticket-1');
    expect(serializedAudit).not.toContain('ticket');
    expect(serializedAudit).not.toContain('172.18.0.23');
    expect(serializedAudit).not.toContain('6099');
    expect(serializedAudit).not.toContain(INTERNAL_SECRET_FIXTURE);
  });

  it('rejects an offline WebUI target before calling Gateway', async () => {
    const accountService = {
      findById: jest.fn(async () => ({
        id: '1001',
        name: '主机器人',
        selfId: '1914728559',
      })),
    };
    const containerService = {
      findPrimaryContainerByAccountId: jest.fn(async () => ({
        baseUrl: 'http://172.18.0.23:6099',
        id: '2001',
        name: 'kt-qqbot-napcat-1914728559',
        sourceContainerOnline: false,
        webuiPort: 6099,
        webuiToken: WEBUI_TOKEN_FIXTURE,
      })),
    };
    const client = {
      createSession: jest.fn(),
    };
    const auditRepository = createRepository<NapcatWebuiGatewayAudit>();
    const service = new QqbotNapcatWebuiGatewayService(
      accountService as never,
      containerService as never,
      client as unknown as QqbotNapcatWebuiGatewayClient,
      new NapcatWebuiGatewayAuditService(auditRepository as never),
    );

    let thrown: unknown;

    try {
      await service.createSession({
        accountId: '1001',
        adminUserId: '3001',
      });
    } catch (error) {
      thrown = error;
    }

    expect(getThrownMessage(thrown)).toBe('NapCat WebUI 不在线');
    expect(client.createSession).not.toHaveBeenCalled();
    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it('rejects malformed account and session ids before downstream calls', async () => {
    const accountService = {
      findById: jest.fn(),
    };
    const containerService = {
      findPrimaryContainerByAccountId: jest.fn(),
    };
    const client = {
      heartbeat: jest.fn(),
    };
    const service = new QqbotNapcatWebuiGatewayService(
      accountService as never,
      containerService as never,
      client as unknown as QqbotNapcatWebuiGatewayClient,
      new NapcatWebuiGatewayAuditService(
        createRepository<NapcatWebuiGatewayAudit>() as never,
      ),
    );
    let createThrown: unknown;
    let heartbeatThrown: unknown;

    try {
      await service.createSession({
        accountId: 'not-a-snowflake',
        adminUserId: '3001',
      });
    } catch (error) {
      createThrown = error;
    }
    try {
      await service.heartbeat({
        adminUserId: '3001',
        sessionId: 'bad session',
      });
    } catch (error) {
      heartbeatThrown = error;
    }

    expect(getThrownMessage(createThrown)).toBe('QQBot 账号ID不合法');
    expect(getThrownMessage(heartbeatThrown)).toBe('Gateway 会话ID不合法');
    expect(accountService.findById).not.toHaveBeenCalled();
    expect(client.heartbeat).not.toHaveBeenCalled();
  });

  it('forwards heartbeat and revoke ownership evidence to the Gateway client', async () => {
    const client = {
      heartbeat: jest.fn(async () => ({ ok: true, status: 'active' })),
      revoke: jest.fn(async () => ({ ok: true, status: 'revoked' })),
    };
    const service = new QqbotNapcatWebuiGatewayService(
      { findById: jest.fn() } as never,
      { findPrimaryContainerByAccountId: jest.fn() } as never,
      client as unknown as QqbotNapcatWebuiGatewayClient,
      new NapcatWebuiGatewayAuditService(
        createRepository<NapcatWebuiGatewayAudit>() as never,
      ),
    );

    await expect(
      service.heartbeat({
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        sessionId: 'sess_1',
        userAgent: 'jest-agent',
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'active',
    });
    await expect(
      service.revoke({
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        sessionId: 'sess_1',
        userAgent: 'jest-agent',
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'revoked',
    });
    expect(client.heartbeat).toHaveBeenCalledWith({
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      sessionId: 'sess_1',
      userAgent: 'jest-agent',
    });
    expect(client.revoke).toHaveBeenCalledWith({
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      sessionId: 'sess_1',
      userAgent: 'jest-agent',
    });
  });

  it('redacts audit key variants and unsafe string values', async () => {
    const auditRepository = createRepository<NapcatWebuiGatewayAudit>();
    const audit = new NapcatWebuiGatewayAuditService(
      auditRepository as never,
    );

    await audit.record({
      accountId: '1001',
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      containerId: '2001',
      detailJson: {
        ['access' + 'Token']: 'plain-secret',
        apiToken: 'plain-secret',
        authorizationHeader: 'Basic abc',
        cookie: 'sid=abc',
        credentialHeader: 'Credential abc',
        docker_ip: '172.18.0.23',
        hostPort: '6099',
        nasRoute: 'nas.kwitsukasa.top:2202',
        nested: {
          display: 'visible',
          loginMessage: 'Bearer abc',
          refreshToken: 'plain-secret',
          redirectPath: '/napcat-webui/session/sess_1/bootstrap?ticket=abc',
        },
        refreshToken: 'plain-secret',
        safe: 'visible',
        setCookie: 'sid=abc; HttpOnly',
        unsafeList: [
          'plain text',
          'token=abc',
          'http://127.0.0.1:48086/internal/sessions',
        ],
        upstreamUrl: 'http://172.18.0.23:6099',
        webui_token: WEBUI_TOKEN_FIXTURE,
      },
      eventType: 'session.create',
      selfId: '1914728559',
      sessionId: 'sess_1',
      userAgent: 'jest-agent',
    });

    const savedAudit = auditRepository.rows[0];

    expect(savedAudit.detailJson).toEqual({
      nested: {
        display: 'visible',
        loginMessage: '[REDACTED]',
        redirectPath: '[REDACTED]',
      },
      safe: 'visible',
      unsafeList: ['plain text', '[REDACTED]', '[REDACTED]'],
    });
    expect(JSON.stringify(savedAudit.detailJson)).not.toContain(
      WEBUI_TOKEN_FIXTURE,
    );
    expect(JSON.stringify(savedAudit.detailJson)).not.toContain('Credential');
    expect(JSON.stringify(savedAudit.detailJson)).not.toContain('172.18.0.23');
    expect(JSON.stringify(savedAudit.detailJson)).not.toContain('6099');
    expect(JSON.stringify(savedAudit.detailJson)).not.toContain('ticket');
  });
});

describe('QqbotNapcatWebuiGatewayClient', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('posts internal session requests with the secret header and unwraps Gateway data', async () => {
    requestMock.mockResolvedValue({
      data: {
        data: {
          expiresAt: EXPIRES_AT_FIXTURE,
          iframeUrl:
            '/napcat-webui/session/sess_1/bootstrap?ticket=bootstrap-ticket-1',
          sessionId: 'sess_1',
        },
      },
    });
    const configService = {
      get: jest.fn((key: string) => {
        return {
          NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL: 'http://127.0.0.1:48086',
          NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET_FIXTURE,
          NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS: '1234',
        }[key];
      }),
    };
    const client = new QqbotNapcatWebuiGatewayClient(configService as never);

    const result = await client.createSession({
      accountId: '1001',
      adminUserId: '3001',
      clientIp: '127.0.0.1',
      containerId: '2001',
      containerName: 'kt-qqbot-napcat-1914728559',
      selfId: '1914728559',
      upstreamBaseUrl: 'http://172.18.0.23:6099',
      userAgent: 'jest-agent',
      webuiToken: WEBUI_TOKEN_FIXTURE,
    });

    expect(requestMock).toHaveBeenCalledWith({
      data: {
        accountId: '1001',
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        containerId: '2001',
        containerName: 'kt-qqbot-napcat-1914728559',
        selfId: '1914728559',
        upstreamBaseUrl: 'http://172.18.0.23:6099',
        userAgent: 'jest-agent',
        webuiToken: WEBUI_TOKEN_FIXTURE,
      },
      headers: {
        'x-kt-gateway-secret': INTERNAL_SECRET_FIXTURE,
      },
      method: 'POST',
      timeout: 1234,
      url: 'http://127.0.0.1:48086/internal/sessions',
    });
    expect(result).toEqual({
      expiresAt: EXPIRES_AT_FIXTURE,
      iframeUrl:
        '/napcat-webui/session/sess_1/bootstrap?ticket=bootstrap-ticket-1',
      sessionId: 'sess_1',
    });
  });

  it('requires the internal Gateway secret before calling axios', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        return {
          NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL: 'http://127.0.0.1:48086',
          NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET: ' ',
          NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS: '1234',
        }[key];
      }),
    };
    const client = new QqbotNapcatWebuiGatewayClient(configService as never);
    let thrown: unknown;

    try {
      await client.createSession({
        accountId: '1001',
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        containerId: '2001',
        containerName: 'kt-qqbot-napcat-1914728559',
        selfId: '1914728559',
        upstreamBaseUrl: 'http://172.18.0.23:6099',
        userAgent: 'jest-agent',
        webuiToken: WEBUI_TOKEN_FIXTURE,
      });
    } catch (error) {
      thrown = error;
    }

    expect(requestMock).not.toHaveBeenCalled();
    expect(getThrownMessage(thrown)).toBe(
      'NapCat WebUI Gateway 内部密钥未配置',
    );
    expect(JSON.stringify(thrown)).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(JSON.stringify(thrown)).not.toContain('172.18.0.23');
    expect(JSON.stringify(thrown)).not.toContain('6099');
  });

  it('posts heartbeat and revoke requests with Admin ownership evidence', async () => {
    requestMock.mockResolvedValueOnce({
      data: { ok: true, status: 'active' },
    });
    requestMock.mockResolvedValueOnce({
      data: { ok: true, status: 'revoked' },
    });
    const configService = {
      get: jest.fn((key: string) => {
        return {
          NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL: 'http://127.0.0.1:48086',
          NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET_FIXTURE,
          NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS: '1234',
        }[key];
      }),
    };
    const client = new QqbotNapcatWebuiGatewayClient(configService as never);

    await expect(
      client.heartbeat({
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        sessionId: 'sess_1',
        userAgent: 'jest-agent',
      }),
    ).resolves.toEqual({ ok: true, status: 'active' });
    await expect(
      client.revoke({
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        sessionId: 'sess_1',
        userAgent: 'jest-agent',
      }),
    ).resolves.toEqual({ ok: true, status: 'revoked' });

    expect(requestMock).toHaveBeenNthCalledWith(1, {
      data: {
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        userAgent: 'jest-agent',
      },
      headers: {
        'x-kt-gateway-secret': INTERNAL_SECRET_FIXTURE,
      },
      method: 'POST',
      timeout: 1234,
      url: 'http://127.0.0.1:48086/internal/sessions/sess_1/heartbeat',
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, {
      data: {
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        userAgent: 'jest-agent',
      },
      headers: {
        'x-kt-gateway-secret': INTERNAL_SECRET_FIXTURE,
      },
      method: 'POST',
      timeout: 1234,
      url: 'http://127.0.0.1:48086/internal/sessions/sess_1/revoke',
    });
  });

  it.each([
    [
      'non-number expiresAt',
      {
        expiresAt: '1782268000000',
        iframeUrl: '/napcat-webui/session/sess_1/',
        sessionId: 'sess_1',
      },
    ],
    [
      'unsafe absolute iframeUrl',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl:
          'http://172.18.0.23:6099/napcat-webui/session/sess_1/bootstrap?ticket=abc',
        sessionId: 'sess_1',
      },
    ],
    [
      'ticket outside bootstrap route',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl: '/napcat-webui/session/sess_1/ticket/abc',
        sessionId: 'sess_1',
      },
    ],
    [
      'multiple query separators',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl:
          '/napcat-webui/session/sess_1/bootstrap?ticket=abc?token=secret',
        sessionId: 'sess_1',
      },
    ],
    [
      'duplicate ticket query',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl:
          '/napcat-webui/session/sess_1/bootstrap?ticket=abc&ticket=def',
        sessionId: 'sess_1',
      },
    ],
    [
      'encoded secret query evidence',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl:
          '/napcat-webui/session/sess_1/bootstrap?ticket=abc%3Ftoken%3Dsecret',
        sessionId: 'sess_1',
      },
    ],
    [
      'non-bootstrap query',
      {
        expiresAt: EXPIRES_AT_FIXTURE,
        iframeUrl: '/napcat-webui/session/sess_1/?ticket=abc',
        sessionId: 'sess_1',
      },
    ],
  ])('rejects invalid Gateway create-session result: %s', async (_case, body) => {
    requestMock.mockResolvedValue({
      data: {
        data: body,
      },
    });
    const configService = {
      get: jest.fn((key: string) => {
        return {
          NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL: 'http://127.0.0.1:48086',
          NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET_FIXTURE,
          NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS: '1234',
        }[key];
      }),
    };
    const client = new QqbotNapcatWebuiGatewayClient(configService as never);
    let thrown: unknown;

    try {
      await client.createSession({
        accountId: '1001',
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        containerId: '2001',
        containerName: 'kt-qqbot-napcat-1914728559',
        selfId: '1914728559',
        upstreamBaseUrl: 'http://172.18.0.23:6099',
        userAgent: 'jest-agent',
        webuiToken: WEBUI_TOKEN_FIXTURE,
      });
    } catch (error) {
      thrown = error;
    }

    expect(getThrownMessage(thrown)).toBe(
      'NapCat WebUI Gateway 返回无效会话',
    );
    expect(JSON.stringify(thrown)).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(JSON.stringify(thrown)).not.toContain(INTERNAL_SECRET_FIXTURE);
    expect(JSON.stringify(thrown)).not.toContain('172.18.0.23');
    expect(JSON.stringify(thrown)).not.toContain('6099');
  });

  it('sanitizes Gateway client errors before returning them to Admin', async () => {
    requestMock.mockRejectedValue(
      new Error(
        `connect http://172.18.0.23:6099 token=${WEBUI_TOKEN_FIXTURE} secret=${INTERNAL_SECRET_FIXTURE} Credential=abc`,
      ),
    );
    const configService = {
      get: jest.fn((key: string) => {
        return {
          NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL: 'http://127.0.0.1:48086',
          NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET_FIXTURE,
          NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS: '1234',
        }[key];
      }),
    };
    const client = new QqbotNapcatWebuiGatewayClient(configService as never);
    let thrown: unknown;

    try {
      await client.createSession({
        accountId: '1001',
        adminUserId: '3001',
        clientIp: '127.0.0.1',
        containerId: '2001',
        containerName: 'kt-qqbot-napcat-1914728559',
        selfId: '1914728559',
        upstreamBaseUrl: 'http://172.18.0.23:6099',
        userAgent: 'jest-agent',
        webuiToken: WEBUI_TOKEN_FIXTURE,
      });
    } catch (error) {
      thrown = error;
    }

    const message = getThrownMessage(thrown) || '';

    expect(message).toBe('NapCat WebUI Gateway 请求失败');
    expect(JSON.stringify(thrown)).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(JSON.stringify(thrown)).not.toContain(INTERNAL_SECRET_FIXTURE);
    expect(JSON.stringify(thrown)).not.toContain('172.18.0.23');
    expect(JSON.stringify(thrown)).not.toContain('6099');
    expect(JSON.stringify(thrown)).not.toContain('Credential');
  });
});

describe('NapCat WebUI Gateway audit schema contract', () => {
  it('keeps entity, domain contract, and SQL schema aligned', () => {
    const refactorSchema = readSource('sql/refactor-v3/00-full-schema.sql');
    const qqbotInitSql = readSource('sql/qqbot-init.sql');
    const tableName = getMetadataArgsStorage().tables.find(
      (table) => table.target === NapcatWebuiGatewayAudit,
    )?.name;

    expect(tableName).toBe('qqbot_napcat_webui_gateway_audit');
    expect(NAPCAT_RUNTIME_ENTITIES).toEqual(
      expect.arrayContaining([NapcatWebuiGatewayAudit]),
    );
    expect(NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining(['qqbot_napcat_webui_gateway_audit']),
    );
    expect(refactorSchema).toContain(
      'CREATE TABLE IF NOT EXISTS qqbot_napcat_webui_gateway_audit',
    );
    expect(qqbotInitSql).toContain(
      'CREATE TABLE IF NOT EXISTS `qqbot_napcat_webui_gateway_audit`',
    );
  });
});
