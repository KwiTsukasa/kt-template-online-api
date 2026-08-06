import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import * as request from 'supertest';
import { WebSocket, WebSocketServer } from 'ws';
import { NapcatWebuiGatewaySessionService } from '../../../src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service';
import { NapcatWebuiGatewayConfigService } from '../../../src/apps/napcat-webui-gateway/config/napcat-webui-gateway-config.service';
import type { NapcatWebuiGatewaySession } from '../../../src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types';
import { NapcatWebuiCredentialClient } from '../../../src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client';
import { NapcatWebuiGatewayTicketService } from '../../../src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service';
import {
  buildGatewayCookiePathRewrite,
  NapcatWebuiProxyService,
  rewriteNapcatLocationHeader,
  rewriteNapcatServiceWorkerAllowedHeader,
  sanitizeGatewayProxyPath,
} from '../../../src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service';
import { PublicWebuiController } from '../../../src/apps/napcat-webui-gateway/presentation/public-webui.controller';

jest.mock('axios');

const SESSION_ID = 'session-1';
const PUBLIC_SESSION_PREFIX = '/admin/napcat-webui/session';
const UPSTREAM_BASE_URL = 'http://127.0.0.1:6099';
const repoRoot = resolve(__dirname, '../../..');
const mockedAxiosPost = axios.post as jest.Mock;

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

function createCredentialConfig(currentTime: { value: number }) {
  return {
    now: () => currentTime.value,
    upstreamTimeoutMs: () => 5000,
  };
}

function readApiSource(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('Napcat WebUI proxy rewrite helpers', () => {
  it('derives the public session prefix from the controlled root-relative base', () => {
    const config = new NapcatWebuiGatewayConfigService({
      get: (key: string) =>
        key === 'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'
          ? '/admin/napcat-webui/'
          : undefined,
    } as never);

    expect(config.publicSessionPrefix()).toBe(PUBLIC_SESSION_PREFIX);
  });

  it('rejects an absolute public base URL', () => {
    const config = new NapcatWebuiGatewayConfigService({
      get: (key: string) =>
        key === 'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'
          ? 'https://evil.test/napcat-webui'
          : undefined,
    } as never);

    expect(() => config.publicSessionPrefix()).toThrow(
      'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL',
    );
  });

  it.each([
    ['space', '/admin/napcat webui'],
    ['encoded separator', '/admin/napcat%2fwebui'],
    ['header delimiter', '/admin/napcat\r\nwebui'],
  ])(
    'rejects an unsafe public base path containing %s',
    (_case, publicBaseUrl) => {
      const config = new NapcatWebuiGatewayConfigService({
        get: (key: string) =>
          key === 'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'
            ? publicBaseUrl
            : undefined,
      } as never);

      expect(() => config.publicSessionPrefix()).toThrow(
        'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL',
      );
    },
  );

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
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
  });

  it('rewrites absolute redirects under the Gateway session prefix without leaking origin', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://127.0.0.1:6099/webui/login?next=/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://container.internal:6099/webui/login',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
  });

  it('rewrites protocol-relative redirects under the Gateway session prefix without leaking origin', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: '//container.internal:6099/webui/login?next=/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
  });

  it('drops upstream redirect query and hash fragments before returning browser locations', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: '/webui/login?Credential=secret#token',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
    expect(
      rewriteNapcatLocationHeader({
        location: 'webui/login?ticket=secret#hash',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/login`);
  });

  it('fails closed for malformed absolute redirects', () => {
    expect(
      rewriteNapcatLocationHeader({
        location: 'http://%',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui`);
    expect(
      rewriteNapcatLocationHeader({
        location: '//%',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
        upstreamBaseUrl: UPSTREAM_BASE_URL,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui`);
  });

  it('scopes all upstream cookies to the Gateway WebUI path', () => {
    expect(
      buildGatewayCookiePathRewrite({
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        sessionId: SESSION_ID,
      }),
    ).toEqual({
      '*': `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui`,
    });
  });

  it('keeps core and plugin Service Worker scopes inside the active Gateway session', () => {
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/webui/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/webui/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBe(`${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/`);
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/example-plugin/files/static/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin/files/static/`,
    );
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBeUndefined();
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/other-plugin/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBeUndefined();
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/webui',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/webui/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBeUndefined();
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/example-plugin',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBeUndefined();
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/example-plugin/files/%E4%B8%AD/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin/files/%E4%B8%AD/`,
    );
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/example-plugin/files/@theme/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin/files/@theme/`,
    );
    expect(
      rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: '/plugin/example-plugin/files/%0d%0aInjected/',
        publicSessionPrefix: PUBLIC_SESSION_PREFIX,
        requestPath: '/plugin/example-plugin/files/static/sw.js',
        sessionId: SESSION_ID,
      }),
    ).toBeUndefined();
  });

  it('keeps request bodies available for the public proxy route', () => {
    const mainSource = readApiSource('src/apps/napcat-webui-gateway/main.ts');
    const proxySource = readApiSource(
      'src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts',
    );

    expect(mainSource).toContain("app.use('/internal', json");
    expect(mainSource).toContain("app.use('/internal', urlencoded");
    expect(mainSource).toContain('bodyParser: false');
    expect(mainSource).not.toContain('app.use(json({ limit');
    expect(mainSource).not.toContain('app.use(urlencoded({ extended');
    expect(proxySource).toContain('fixRequestBody');
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
          provide: NapcatWebuiGatewayConfigService,
          useValue: {
            publicSessionPrefix: () => PUBLIC_SESSION_PREFIX,
          },
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
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui`,
    );
    expect(response.headers['set-cookie']).toEqual([
      expect.stringContaining(`Path=${PUBLIC_SESSION_PREFIX}/${SESSION_ID}`),
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

describe('NapcatWebuiProxyService redirect rewriting', () => {
  let app: INestApplication;
  let upstream: Server;
  let upstreamBaseUrl: string;
  let sessionService: {
    requireProxySession: jest.Mock;
  };
  let credentialClient: {
    getCredential: jest.Mock;
  };
  let upstreamRequests: Array<{
    authorization?: string;
    method?: string;
    url?: string;
  }>;

  async function startRedirectUpstream() {
    const server = createServer((req, res) => {
      upstreamRequests.push({
        authorization: req.headers.authorization,
        method: req.method,
        url: req.url,
      });

      if (req.url === '/api/File/list?path=%2F') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/json; charset=UTF-8');
        res.end(
          JSON.stringify({
            code: 0,
            data: [{ isDirectory: true, name: 'app', size: 0 }],
            message: 'success',
          }),
        );
        return;
      }

      if (req.url === '/webui') {
        res.statusCode = HttpStatus.MOVED_PERMANENTLY;
        res.setHeader('content-type', 'text/html; charset=UTF-8');
        res.setHeader('location', '/webui/');
        res.end('<a href="/webui/">Redirecting</a>');
        return;
      }

      if (req.url === '/webui/sw.js') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/javascript; charset=UTF-8');
        res.setHeader('service-worker-allowed', '/webui/');
        res.end('self.addEventListener("fetch", () => undefined);');
        return;
      }

      if (req.url === '/plugin/example-plugin/page/dashboard') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'text/html; charset=UTF-8');
        res.end(
          [
            '<!doctype html><html><head>',
            '<link rel="stylesheet" href="/plugin/example-plugin/files/static/app.css">',
            '<link rel="manifest" href="/plugin/example-plugin/files/static/manifest.webmanifest">',
            '<script type="module" src="/plugin/example-plugin/files/static/app.js"></script>',
            '</head><body></body></html>',
          ].join(''),
        );
        return;
      }

      if (req.url === '/plugin/example-plugin/files/static/app.js') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/javascript; charset=UTF-8');
        res.end(
          [
            'const coreApi = "/api/Base/Theme";',
            'const pluginApi = "/plugin/example-plugin/api/settings";',
            'const socket = "/api/Debug/ws";',
            'const absoluteSocket = `${protocol}//${window.location.host}/api/Debug/ws`;',
            'navigator.serviceWorker.register("/plugin/example-plugin/files/static/sw.js", { scope: "/plugin/example-plugin/files/static/" });',
          ].join(''),
        );
        return;
      }

      if (
        req.url ===
        '/plugin/example-plugin/files/static/manifest.webmanifest'
      ) {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/manifest+json');
        res.end(
          JSON.stringify({
            icons: [
              {
                src: '/plugin/example-plugin/files/static/icon.png',
              },
            ],
            scope: '/plugin/example-plugin/files/static/',
            start_url: '/plugin/example-plugin/page/dashboard',
          }),
        );
        return;
      }

      if (req.url === '/plugin/example-plugin/api/events.js') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/json; charset=UTF-8');
        res.end(
          JSON.stringify({
            untouched: '/plugin/example-plugin/api/events.js',
          }),
        );
        return;
      }

      if (req.url === '/plugin/example-plugin/files/static/app.css') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'text/css; charset=UTF-8');
        res.end('body{background-image:url("/plugin/example-plugin/files/static/bg.png")}');
        return;
      }

      if (req.url === '/plugin/example-plugin/files/static/sw.js') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/javascript; charset=UTF-8');
        res.setHeader(
          'service-worker-allowed',
          '/plugin/example-plugin/files/static/',
        );
        res.end(
          'importScripts("/plugin/example-plugin/files/static/workbox.js");',
        );
        return;
      }

      if (req.url === '/plugin/example-plugin/files/static/unsafe-sw.js') {
        res.statusCode = HttpStatus.OK;
        res.setHeader('content-type', 'application/javascript; charset=UTF-8');
        res.setHeader('service-worker-allowed', '/');
        res.end('self.addEventListener("fetch", () => undefined);');
        return;
      }

      res.statusCode = HttpStatus.OK;
      res.setHeader('content-type', 'text/html; charset=UTF-8');
      res.setHeader('set-cookie', [
        'napcat_session=active; Domain=container.internal; Path=/webui; HttpOnly',
        'napcat_theme=dark; SameSite=Lax',
      ]);
      res.end('<script type="module" src="/webui/assets/index.js"></script>');
    });

    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('proxy rewrite test upstream did not expose a port');
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      server,
    };
  }

  beforeEach(async () => {
    upstreamRequests = [];
    const started = await startRedirectUpstream();
    upstream = started.server;
    upstreamBaseUrl = started.baseUrl;

    sessionService = {
      requireProxySession: jest.fn(),
    };
    credentialClient = {
      getCredential: jest.fn().mockResolvedValue('credential-1'),
    };

    sessionService.requireProxySession.mockResolvedValue(
      createGatewaySession({
        status: 'active',
        upstreamBaseUrl,
      }),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicWebuiController],
      providers: [
        {
          provide: NapcatWebuiGatewaySessionService,
          useValue: sessionService,
        },
        {
          provide: NapcatWebuiGatewayTicketService,
          useValue: {
            redeem: jest.fn(),
          },
        },
        {
          provide: NapcatWebuiGatewayConfigService,
          useValue: {
            publicSessionPrefix: () => PUBLIC_SESSION_PREFIX,
          },
        },
        {
          provide: NapcatWebuiCredentialClient,
          useValue: credentialClient,
        },
        NapcatWebuiProxyService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((resolveClose) =>
      upstream.close(() => resolveClose()),
    );
  });

  it('rewrites upstream WebUI redirects before intercepted headers are copied to the browser', async () => {
    const response = await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/webui/webui`)
      .redirects(0)
      .expect(HttpStatus.MOVED_PERMANENTLY);

    expect(response.headers.location).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/`,
    );
  });

  it('confines the upstream Service Worker scope to the active public Gateway session', async () => {
    const response = await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/webui/webui/sw.js`)
      .expect(HttpStatus.OK);

    expect(response.headers['service-worker-allowed']).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/webui/`,
    );
  });

  it('rewrites every plugin page and its root-relative assets under the active Gateway session', async () => {
    const pluginGatewayPrefix = `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin`;
    const response = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/page/dashboard`,
      )
      .expect(HttpStatus.OK);

    expect(response.text).toContain(
      `href="${pluginGatewayPrefix}/files/static/app.css"`,
    );
    expect(response.text).toContain(
      `src="${pluginGatewayPrefix}/files/static/app.js"`,
    );
    expect(response.text).toContain(
      `href="${pluginGatewayPrefix}/files/static/manifest.webmanifest"`,
    );
    expect(response.text).not.toContain('href="/plugin/');
    expect(response.text).not.toContain('src="/plugin/');

    const assetResponse = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/files/static/app.css`,
      )
      .expect(HttpStatus.OK);

    expect(assetResponse.headers['content-type']).toContain('text/css');
    expect(assetResponse.text).toContain(
      `url("${pluginGatewayPrefix}/files/static/bg.png")`,
    );
    expect(upstreamRequests).toContainEqual({
      authorization: 'Bearer credential-1',
      method: 'GET',
      url: '/plugin/example-plugin/page/dashboard',
    });
    expect(upstreamRequests).toContainEqual({
      authorization: 'Bearer credential-1',
      method: 'GET',
      url: '/plugin/example-plugin/files/static/app.css',
    });

    const scriptResponse = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/files/static/app.js`,
      )
      .expect(HttpStatus.OK);

    expect(scriptResponse.headers['content-type']).toContain(
      'application/javascript',
    );
    expect(scriptResponse.text).toContain(
      `"${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/api/Base/Theme"`,
    );
    expect(scriptResponse.text).toContain(
      `"${pluginGatewayPrefix}/api/settings"`,
    );
    expect(scriptResponse.text).toContain(
      `"${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/api/Debug/ws"`,
    );
    expect(scriptResponse.text).toContain(
      '`${protocol}//${window.location.host}' +
        `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/api/Debug/ws\``,
    );
    expect(scriptResponse.text).toContain(
      `register("${pluginGatewayPrefix}/files/static/sw.js", { scope: "${pluginGatewayPrefix}/files/static/" })`,
    );

    const manifestResponse = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/files/static/manifest.webmanifest`,
      )
      .expect(HttpStatus.OK);

    expect(manifestResponse.headers['content-type']).toContain(
      'application/manifest+json',
    );
    expect(manifestResponse.text).toContain(
      `${pluginGatewayPrefix}/page/dashboard`,
    );
    expect(manifestResponse.text).toContain(
      `${pluginGatewayPrefix}/files/static/icon.png`,
    );

    const apiResponse = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/api/events.js`,
      )
      .expect(HttpStatus.OK);

    expect(apiResponse.body).toEqual({
      untouched: '/plugin/example-plugin/api/events.js',
    });
  });

  it('preserves plugin-owned Service Worker scopes under the active Gateway session', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/files/static/sw.js`,
      )
      .expect(HttpStatus.OK);

    expect(response.headers['service-worker-allowed']).toBe(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin/files/static/`,
    );
    expect(response.text).toContain(
      `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui/plugin/example-plugin/files/static/workbox.js`,
    );

    const unsafeResponse = await request(app.getHttpServer())
      .get(
        `/napcat-webui/session/${SESSION_ID}/webui/plugin/example-plugin/files/static/unsafe-sw.js`,
      )
      .expect(HttpStatus.OK);

    expect(unsafeResponse.headers['service-worker-allowed']).toBeUndefined();
  });

  it('forwards NapCat File API requests under /api without duplicating the Gateway session prefix', async () => {
    const response = await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/webui/api/File/list?path=%2F`)
      .expect(HttpStatus.OK);

    expect(response.body).toEqual({
      code: 0,
      data: [{ isDirectory: true, name: 'app', size: 0 }],
      message: 'success',
    });
    expect(upstreamRequests).toContainEqual({
      authorization: 'Bearer credential-1',
      method: 'GET',
      url: '/api/File/list?path=%2F',
    });
    expect(
      upstreamRequests.some((item) =>
        item.url?.includes('/api/napcat-webui/session/'),
      ),
    ).toBe(false);
  });

  it('scopes intercepted text-response cookies to the configured public session path', async () => {
    const response = await request(app.getHttpServer())
      .get(`/napcat-webui/session/${SESSION_ID}/webui/webui/assets/index.html`)
      .expect(HttpStatus.OK);
    const cookiePath = `${PUBLIC_SESSION_PREFIX}/${SESSION_ID}/webui`;

    expect(response.headers['set-cookie']).toEqual([
      expect.stringContaining(`Path=${cookiePath}`),
      expect.stringContaining(`Path=${cookiePath}`),
    ]);
    expect(String(response.headers['set-cookie'])).not.toMatch(/Domain=/i);
  });
});

describe('NapcatWebuiProxyService WebSocket forwarding', () => {
  let app: INestApplication;
  let gatewayPort: number;
  let upstream: Server;
  let upstreamRequest: { authorization?: string; cookie?: string; url?: string };
  let upstreamWebSocket: WebSocketServer;

  beforeEach(async () => {
    upstreamRequest = {};
    upstream = createServer();
    upstreamWebSocket = new WebSocketServer({ noServer: true });
    upstream.on('upgrade', (req, socket, head) => {
      upstreamRequest = {
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        url: req.url,
      };
      upstreamWebSocket.handleUpgrade(req, socket, head, (webSocket) => {
        upstreamWebSocket.emit('connection', webSocket, req);
      });
    });
    upstreamWebSocket.on('connection', (webSocket) => {
      webSocket.send('upstream-ready');
    });
    await new Promise<void>((resolveListen) => {
      upstream.listen(0, '127.0.0.1', resolveListen);
    });
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('WebSocket upstream did not expose a port');
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: NapcatWebuiGatewaySessionService,
          useValue: {
            requireProxySession: jest.fn().mockResolvedValue(
              createGatewaySession({
                status: 'active',
                upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
              }),
            ),
          },
        },
        {
          provide: NapcatWebuiGatewayConfigService,
          useValue: {
            publicSessionPrefix: () => PUBLIC_SESSION_PREFIX,
          },
        },
        {
          provide: NapcatWebuiCredentialClient,
          useValue: {
            getCredential: jest.fn().mockResolvedValue('credential-1'),
          },
        },
        NapcatWebuiProxyService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    app
      .get(NapcatWebuiProxyService)
      .bindWebSocketUpgrade(app.getHttpServer());
    await app.listen(0, '127.0.0.1');
    const gatewayAddress = app.getHttpServer().address();
    if (!gatewayAddress || typeof gatewayAddress === 'string') {
      throw new Error('WebSocket Gateway did not expose a port');
    }
    gatewayPort = gatewayAddress.port;
  });

  afterEach(async () => {
    upstreamWebSocket.clients.forEach((webSocket) => webSocket.terminate());
    await new Promise<void>((resolveClose) =>
      upstreamWebSocket.close(() => resolveClose()),
    );
    await app?.close();
    await new Promise<void>((resolveClose) =>
      upstream.close(() => resolveClose()),
    );
  });

  it('forwards plugin runtime WebSockets with their adapter token but without browser headers', async () => {
    const webSocket = new WebSocket(
      `ws://127.0.0.1:${gatewayPort}/napcat-webui/session/${SESSION_ID}/webui/api/Debug/ws?channel=plugin&access_token=plugin-adapter-token`,
      {
        headers: {
          Authorization: 'Bearer browser-value',
          Cookie: 'browser-cookie=value',
        },
      },
    );

    await new Promise<void>((resolveMessage, rejectMessage) => {
      webSocket.once('message', (data) => {
        expect(data.toString()).toBe('upstream-ready');
        resolveMessage();
      });
      webSocket.once('error', rejectMessage);
    });
    webSocket.close();

    expect(upstreamRequest).toEqual({
      authorization: 'Bearer credential-1',
      cookie: undefined,
      url: '/api/Debug/ws?channel=plugin&access_token=plugin-adapter-token',
    });
  });
});
