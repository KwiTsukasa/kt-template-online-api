import { createHash } from 'node:crypto';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import * as request from 'supertest';
import { NapcatWebuiGatewaySessionService } from '../../../src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service';
import type { NapcatWebuiGatewaySession } from '../../../src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types';
import { NapcatWebuiCredentialClient } from '../../../src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client';
import { NapcatWebuiGatewayTicketService } from '../../../src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service';
import {
  buildGatewayCookiePathRewrite,
  NapcatWebuiProxyService,
  rewriteNapcatLocationHeader,
  sanitizeGatewayProxyPath,
} from '../../../src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service';
import { PublicWebuiController } from '../../../src/apps/napcat-webui-gateway/presentation/public-webui.controller';

jest.mock('axios');

const SESSION_ID = 'session-1';
const UPSTREAM_BASE_URL = 'http://127.0.0.1:6099';
const mockedAxiosPost = axios.post as jest.Mock;

/**
 * Creates server-only Gateway session metadata for public bootstrap tests.
 * @param override - Session fields that should replace the default fixture.
 * @returns Gateway session fixture.
 */
function createGatewaySession(
  override: Partial<NapcatWebuiGatewaySession> = {},
): NapcatWebuiGatewaySession {
  return {
    accountId: 'account-1',
    adminUserId: 'admin-1',
    containerId: 'container-1',
    containerName: 'kt-qqbot-napcat-1914728559',
    createdAt: 1000,
    expiresAt: 61_000,
    selfId: '1914728559',
    sessionId: SESSION_ID,
    status: 'created',
    upstreamBaseUrl: UPSTREAM_BASE_URL,
    webuiToken: ['webui', 'token', 'fixture'].join('-'),
    ...override,
  };
}

/**
 * Creates a Gateway config fixture for credential client tests.
 * @param currentTime - Mutable timestamp source used to check cache expiry decisions.
 * @returns Config facade shape required by NapcatWebuiCredentialClient.
 */
function createCredentialConfig(currentTime: { value: number }) {
  return {
    now: () => currentTime.value,
    upstreamTimeoutMs: () => 5000,
  };
}

describe('Napcat WebUI proxy rewrite helpers', () => {
  it('rejects absolute URL proxy paths', () => {
    expect(() => sanitizeGatewayProxyPath('https://evil.test/api')).toThrow(
      'Gateway proxy path is invalid',
    );
  });

  it('rejects dot-segment traversal proxy paths', () => {
    expect(() => sanitizeGatewayProxyPath('../api/auth/login')).toThrow(
      'Gateway proxy path is invalid',
    );
  });

  it('rejects encoded dot-segment traversal proxy paths', () => {
    expect(() => sanitizeGatewayProxyPath('%2e%2e/api/auth/login')).toThrow(
      'Gateway proxy path is invalid',
    );
  });

  it('rejects double-encoded dot-segment traversal proxy paths', () => {
    expect(() => sanitizeGatewayProxyPath('%252e%252e/api/auth/login')).toThrow(
      'Gateway proxy path is invalid',
    );
  });

  it('normalizes string proxy paths to absolute upstream paths', () => {
    expect(sanitizeGatewayProxyPath('api/QQLogin/CheckLoginStatus')).toBe(
      '/api/QQLogin/CheckLoginStatus',
    );
  });

  it('normalizes path-to-regexp array proxy paths to absolute upstream paths', () => {
    expect(
      sanitizeGatewayProxyPath(['api', 'QQLogin', 'CheckLoginStatus']),
    ).toBe('/api/QQLogin/CheckLoginStatus');
  });

  it('rewrites NapCat relative redirects under the Gateway session prefix', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: '/webui/login',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`/napcat-webui/session/${SESSION_ID}/webui/webui/login`);
  });

  it('rewrites absolute redirects under the Gateway session prefix without leaking origin', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://127.0.0.1:6099/webui/login?next=/',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(
      `/napcat-webui/session/${SESSION_ID}/webui/webui/login?next=/`,
    );
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://container.internal:6099/webui/login',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`/napcat-webui/session/${SESSION_ID}/webui/webui/login`);
  });

  it('rewrites protocol-relative redirects under the Gateway session prefix without leaking origin', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: '//container.internal:6099/webui/login?next=/',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(
      `/napcat-webui/session/${SESSION_ID}/webui/webui/login?next=/`,
    );
  });

  it('fails closed for malformed absolute redirects', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://%',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`/napcat-webui/session/${SESSION_ID}/webui/webui`);
    expect(
      rewriteNapcatLocationHeader({
        location: '//%',
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`/napcat-webui/session/${SESSION_ID}/webui/webui`);
  });

  it('scopes all upstream cookies to the Gateway WebUI path', () => {
    expect(buildGatewayCookiePathRewrite({ sessionId: SESSION_ID })).toEqual({
      '*': `/napcat-webui/session/${SESSION_ID}/webui`,
    });
  });
});

describe('NapcatWebuiCredentialClient', () => {
  beforeEach(() => {
    mockedAxiosPost.mockReset();
  });

  it('exchanges the WebUI token hash and caches the server-side Credential until session expiry', async () => {
    const currentTime = { value: 1000 };
    const client = new NapcatWebuiCredentialClient(
      createCredentialConfig(currentTime) as never,
    );
    mockedAxiosPost.mockResolvedValue({ data: { Credential: 'credential-1' } });

    await expect(client.getCredential(createGatewaySession())).resolves.toBe(
      'credential-1',
    );
    await expect(client.getCredential(createGatewaySession())).resolves.toBe(
      'credential-1',
    );

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockedAxiosPost).toHaveBeenCalledWith(
      `${UPSTREAM_BASE_URL}/api/auth/login`,
      {
        hash: createHash('sha256')
          .update('webui-token-fixture.napcat')
          .digest('hex'),
      },
      { timeout: 5000 },
    );
  });

  it('clears cached Credential when the Gateway session is revoked', async () => {
    const currentTime = { value: 1000 };
    const client = new NapcatWebuiCredentialClient(
      createCredentialConfig(currentTime) as never,
    );
    mockedAxiosPost
      .mockResolvedValueOnce({ data: { Credential: 'credential-1' } })
      .mockResolvedValueOnce({ data: { Credential: 'credential-2' } });

    await expect(client.getCredential(createGatewaySession())).resolves.toBe(
      'credential-1',
    );
    client.clear(SESSION_ID);

    await expect(client.getCredential(createGatewaySession())).resolves.toBe(
      'credential-2',
    );
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });
});

describe('PublicWebuiController bootstrap', () => {
  let app: INestApplication;
  let ticketService: { redeem: jest.Mock };
  let sessionService: {
    markActive: jest.Mock;
    requireBootstrapSession: jest.Mock;
  };

  beforeAll(async () => {
    ticketService = {
      redeem: jest.fn(),
    };
    sessionService = {
      markActive: jest.fn(),
      requireBootstrapSession: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicWebuiController],
      providers: [
        {
          provide: NapcatWebuiGatewaySessionService,
          useValue: sessionService,
        },
        {
          provide: NapcatWebuiGatewayTicketService,
          useValue: ticketService,
        },
        {
          provide: NapcatWebuiProxyService,
          useValue: {
            handleHttpProxy: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    ticketService.redeem.mockReset();
    sessionService.markActive.mockReset();
    sessionService.requireBootstrapSession.mockReset();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('redeems a ticket, activates the session, sets an HttpOnly cookie, and redirects to WebUI', async () => {
    ticketService.redeem.mockResolvedValue(SESSION_ID);
    sessionService.requireBootstrapSession.mockResolvedValue(
      createGatewaySession(),
    );
    sessionService.markActive.mockResolvedValue(
      createGatewaySession({ status: 'active' }),
    );

    const response = await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/bootstrap?ticket=ticket-1`)
      .expect(HttpStatus.FOUND);

    expect(ticketService.redeem).toHaveBeenCalledWith('ticket-1');
    expect(sessionService.requireBootstrapSession).toHaveBeenCalledWith(
      SESSION_ID,
    );
    expect(sessionService.markActive).toHaveBeenCalledWith(SESSION_ID);
    expect(response.headers.location).toBe(
      `/napcat-webui/session/${SESSION_ID}/webui/webui`,
    );
    expect(response.headers['set-cookie']).toEqual([
      expect.stringContaining(`Path=/napcat-webui/session/${SESSION_ID}`),
    ]);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('rejects expired tickets without activating the session', async () => {
    ticketService.redeem.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/bootstrap?ticket=expired`)
      .expect(HttpStatus.GONE);

    expect(sessionService.requireBootstrapSession).not.toHaveBeenCalled();
    expect(sessionService.markActive).not.toHaveBeenCalled();
  });
});
