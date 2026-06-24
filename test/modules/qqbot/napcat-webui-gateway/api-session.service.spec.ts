import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HttpException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import axios from 'axios';
import {
  QqbotNapcatWebuiGatewayService,
  NapcatWebuiGatewayAuditService,
} from '../../../../src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service';
import { QqbotNapcatWebuiGatewayClient } from '../../../../src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client';
import { NapcatWebuiGatewayAudit } from '../../../../src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity';
import {
  NAPCAT_RUNTIME_DOMAIN_CONTRACT,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat/infrastructure/persistence';

jest.mock('axios');

const repoRoot = resolve(__dirname, '../../../..');
const requestMock = axios.request as jest.Mock;
const EXPIRES_AT_FIXTURE = 1782268000000;
const INTERNAL_SECRET_FIXTURE = ['internal', 'secret'].join('-');
const WEBUI_TOKEN_FIXTURE = ['webui', 'token', 'fixture'].join('-');

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
      iframeUrl: '/napcat-webui-gateway/session/sess_1/',
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
        id: '2001',
        name: 'kt-qqbot-napcat-1914728559',
        webuiStatus: 'online',
      },
      expiresAt: EXPIRES_AT_FIXTURE,
      iframeUrl: '/napcat-webui-gateway/session/sess_1/',
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
      iframeUrl: '/napcat-webui-gateway/session/sess_1/',
      webuiStatus: 'online',
    });
    expect(serializedAudit).not.toContain(WEBUI_TOKEN_FIXTURE);
    expect(serializedAudit).not.toContain('Credential');
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

  it('forwards heartbeat and revoke to the Gateway client', async () => {
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

    await expect(service.heartbeat('sess_1')).resolves.toEqual({
      ok: true,
      status: 'active',
    });
    await expect(service.revoke('sess_1')).resolves.toEqual({
      ok: true,
      status: 'revoked',
    });
    expect(client.heartbeat).toHaveBeenCalledWith('sess_1');
    expect(client.revoke).toHaveBeenCalledWith('sess_1');
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
          iframeUrl: '/napcat-webui-gateway/session/sess_1/',
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
      iframeUrl: '/napcat-webui-gateway/session/sess_1/',
      sessionId: 'sess_1',
    });
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
