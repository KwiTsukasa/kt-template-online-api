import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  createProxyMiddleware,
  fixRequestBody,
  responseInterceptor,
  type RequestHandler,
} from 'http-proxy-middleware';
import { NapcatWebuiGatewaySessionService } from '../../application/napcat-webui-gateway-session.service';
import type { NapcatWebuiGatewaySession } from '../../domain/napcat-webui-gateway.types';
import { NapcatWebuiCredentialClient } from '../napcat-webui-credential.client';

const GATEWAY_WEBUI_PREFIX = '/napcat-webui/session';
const GATEWAY_BROWSER_TOKEN_PREFIX = 'kt-napcat-webui-gateway:';
const TEXT_REWRITE_EXTENSIONS = ['.css', '.html', '.js', '.mjs'] as const;
const STRIPPED_UPSTREAM_HEADERS = [
  'authorization',
  'cookie',
  'x-admin-token',
  'x-api-token',
  'x-access-token',
  'x-kt-access-token',
  'x-kt-gateway-secret',
  'x-wordpress-cookie',
] as const;

type ProxyPathInput = string | string[] | undefined;

type RewriteLocationInput = {
  location: string;
  sessionId: string;
  upstreamBaseUrl: string;
};

type CookiePathRewriteInput = {
  sessionId: string;
};

type RewriteTextResponseInput = {
  body: string;
  sessionId: string;
};

type RewriteWebSocketSearchInput = {
  credential: string;
  search: string;
  upstreamPath: string;
};

export function sanitizeGatewayProxyPath(input: ProxyPathInput) {
  const raw = Array.isArray(input) ? input.join('/') : String(input || '');
  const trimmed = raw.trim();
  const decoded = decodeProxyPath(trimmed);

  if (
    !decoded ||
    decoded.includes('\\') ||
    decoded.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    throw new BadRequestException('Gateway proxy path is invalid');
  }

  const path = decoded.startsWith('/') ? decoded : `/${decoded}`;
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) {
    throw new BadRequestException('Gateway proxy path is invalid');
  }

  return path;
}

export function rewriteNapcatLocationHeader(input: RewriteLocationInput) {
  const gatewayPrefix = `${GATEWAY_WEBUI_PREFIX}/${encodeURIComponent(
    input.sessionId,
  )}/webui`;
  const location = input.location.trim();
  if (!location) return location;

  const fallback = `${gatewayPrefix}/webui`;
  if (location.startsWith('//')) {
    try {
      const upstream = new URL(input.upstreamBaseUrl);
      const target = new URL(`${upstream.protocol}${location}`);
      return toGatewayRedirectLocation(gatewayPrefix, target.pathname);
    } catch {
      return fallback;
    }
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(location)) {
    try {
      const target = new URL(location, 'http://gateway.local');
      return toGatewayRedirectLocation(gatewayPrefix, target.pathname);
    } catch {
      return fallback;
    }
  }

  try {
    const target = new URL(location);
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      return toGatewayRedirectLocation(gatewayPrefix, target.pathname);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function buildGatewayCookiePathRewrite(input: CookiePathRewriteInput) {
  return {
    '*': `${GATEWAY_WEBUI_PREFIX}/${encodeURIComponent(input.sessionId)}/webui`,
  };
}

export function rewriteNapcatTextResponse(input: RewriteTextResponseInput) {
  const gatewayWebuiPrefix = `${GATEWAY_WEBUI_PREFIX}/${encodeURIComponent(
    input.sessionId,
  )}/webui`;

  const rewritten = input.body.replace(
    /(^|[\s"'`(=,:])\/(webui|api|files|plugin)(?=\/|[?#"'`)]|$)/g,
    (_match, leader: string, root: string) =>
      `${leader}${gatewayWebuiPrefix}/${root}`,
  );

  return injectGatewayBrowserToken({
    body: rewritten,
    sessionId: input.sessionId,
  });
}

export function rewriteNapcatWebSocketSearch(
  input: RewriteWebSocketSearchInput,
) {
  if (input.upstreamPath !== '/api/ws/terminal') {
    return input.search;
  }

  const params = new URLSearchParams(input.search);
  params.set('token', input.credential);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function injectGatewayBrowserToken(input: RewriteTextResponseInput) {
  if (
    input.body.includes('data-kt-napcat-webui-gateway-sso') ||
    !/<html[\s>]/i.test(input.body)
  ) {
    return input.body;
  }

  const script = buildGatewayBrowserTokenScript(input.sessionId);
  if (/<head[\s>]/i.test(input.body)) {
    return input.body.replace(/<head(\s[^>]*)?>/i, (headTag) => {
      return `${headTag}${script}`;
    });
  }

  return input.body.replace(
    /<script\b/i,
    `${script}<script`,
  );
}

function buildGatewayBrowserTokenScript(sessionId: string) {
  const browserToken = `${GATEWAY_BROWSER_TOKEN_PREFIX}${sessionId}`;
  const storedTokenLiteral = JSON.stringify(JSON.stringify(browserToken));

  return [
    '<script data-kt-napcat-webui-gateway-sso>',
    'try{',
    `localStorage.setItem("token",${storedTokenLiteral});`,
    '}catch(_error){}',
    '</script>',
  ].join('');
}

function decodeProxyPath(value: string) {
  try {
    let decoded = value;
    for (let index = 0; index < 6; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return next;
      }
      decoded = next;
    }
  } catch {
    throw new BadRequestException('Gateway proxy path is invalid');
  }

  throw new BadRequestException('Gateway proxy path is invalid');
}

function toGatewayRedirectLocation(
  gatewayPrefix: string,
  upstreamPathname: string,
) {
  try {
    return `${gatewayPrefix}${sanitizeGatewayProxyPath(
      upstreamPathname || '/webui',
    )}`;
  } catch {
    return `${gatewayPrefix}/webui`;
  }
}

export function shouldRewriteNapcatTextResponse(upstreamPath: string) {
  const pathname = new URL(upstreamPath, 'http://gateway.local').pathname;
  const filename = pathname.split('/').pop() || '';
  const extensionIndex = filename.lastIndexOf('.');
  const extension =
    extensionIndex >= 0 ? filename.slice(extensionIndex).toLowerCase() : '';

  if (TEXT_REWRITE_EXTENSIONS.includes(extension as never)) {
    return true;
  }

  return (
    pathname === '/webui' ||
    (pathname.startsWith('/webui/') && extensionIndex < 0)
  );
}

@Injectable()
export class NapcatWebuiProxyService {
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly credentialClient: NapcatWebuiCredentialClient,
  ) {}

  async handleHttpProxy(
    sessionId: string,
    proxyPath: ProxyPathInput,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const session = await this.sessionService.requireProxySession(sessionId);
    const upstreamPath = this.buildUpstreamPath(proxyPath, req.originalUrl);
    const credential = await this.credentialClient.getCredential(session);
    this.stripBrowserHeaders(req);
    req.url = upstreamPath;

    const proxy = this.createProxy(
      session,
      credential,
      shouldRewriteNapcatTextResponse(upstreamPath),
    );
    return proxy(req, res, next);
  }

  bindWebSocketUpgrade(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      void this.handleWebSocketUpgrade(req, socket as Socket, head);
    });
  }

  private async handleWebSocketUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ) {
    try {
      const match = this.matchGatewayUpgrade(req.url || '');
      if (!match) return;
      const session = await this.sessionService.requireProxySession(
        match.sessionId,
      );
      const credential = await this.credentialClient.getCredential(session);
      this.stripBrowserHeaders(req);
      req.url = `${match.proxyPath}${rewriteNapcatWebSocketSearch({
        credential,
        search: match.search,
        upstreamPath: match.proxyPath,
      })}`;
      const proxy = this.createProxy(session, credential);
      proxy.upgrade(req, socket, head);
    } catch {
      this.rejectUpgrade(socket);
    }
  }

  private createProxy(
    session: NapcatWebuiGatewaySession,
    credential: string,
    rewriteTextResponse = false,
  ): RequestHandler<Request, Response, NextFunction> {
    return createProxyMiddleware<Request, Response, NextFunction>({
      changeOrigin: true,
      cookiePathRewrite: buildGatewayCookiePathRewrite({
        sessionId: session.sessionId,
      }),
      on: {
        error: (_error, _req, res) => {
          this.writeProxyError(res);
        },
        proxyReq: (proxyReq, req) => {
          proxyReq.removeHeader('cookie');
          proxyReq.setHeader('Authorization', `Bearer ${credential}`);
          fixRequestBody(proxyReq, req);
        },
        proxyReqWs: (proxyReq) => {
          proxyReq.removeHeader('cookie');
          proxyReq.setHeader('Authorization', `Bearer ${credential}`);
        },
        proxyRes: this.createProxyResponseHandler(
          session,
          rewriteTextResponse,
        ),
      },
      secure: false,
      selfHandleResponse: rewriteTextResponse,
      target: session.upstreamBaseUrl,
      ws: true,
    });
  }

  private createProxyResponseHandler(
    session: NapcatWebuiGatewaySession,
    rewriteTextResponse: boolean,
  ) {
    if (!rewriteTextResponse) {
      return (proxyRes: IncomingMessage) => {
        this.rewriteLocationHeader(proxyRes.headers, session);
      };
    }

    const interceptTextResponse = responseInterceptor(
      async (responseBuffer) =>
        rewriteNapcatTextResponse({
          body: responseBuffer.toString('utf8'),
          sessionId: session.sessionId,
        }),
    );

    return (proxyRes: IncomingMessage, req: Request, res: Response) => {
      this.rewriteLocationHeader(proxyRes.headers, session);
      return interceptTextResponse(proxyRes, req, res);
    };
  }

  private rewriteLocationHeader(
    headers: Record<string, number | string | string[] | undefined>,
    session: NapcatWebuiGatewaySession,
  ) {
    const location = headers.location;
    if (typeof location === 'string') {
      headers.location = rewriteNapcatLocationHeader({
        location,
        sessionId: session.sessionId,
        upstreamBaseUrl: session.upstreamBaseUrl,
      });
    }
  }

  private buildUpstreamPath(proxyPath: ProxyPathInput, originalUrl?: string) {
    const pathname = sanitizeGatewayProxyPath(proxyPath);
    const queryIndex = String(originalUrl || '').indexOf('?');
    const query = queryIndex >= 0 ? String(originalUrl).slice(queryIndex) : '';
    return `${pathname}${query}`;
  }

  private matchGatewayUpgrade(rawUrl: string) {
    const url = new URL(rawUrl, 'http://gateway.local');
    const match = url.pathname.match(
      /^\/napcat-webui\/session\/([^/]+)\/webui(?:\/(.*))?$/,
    );
    if (!match) return undefined;

    return {
      proxyPath: sanitizeGatewayProxyPath(match[2] || ''),
      search: url.search,
      sessionId: decodeURIComponent(match[1]),
    };
  }

  private stripBrowserHeaders(req: IncomingMessage) {
    STRIPPED_UPSTREAM_HEADERS.forEach((header) => {
      delete req.headers[header];
    });
  }

  private writeProxyError(res: Response | Socket) {
    if ('headersSent' in res) {
      if (res.headersSent) return;
      res.status(HttpStatus.BAD_GATEWAY).json({
        message: 'NapCat WebUI proxy failed',
        statusCode: HttpStatus.BAD_GATEWAY,
      });
      return;
    }
    this.rejectUpgrade(res);
  }

  private rejectUpgrade(socket: Socket) {
    if (socket.writable) {
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    }
    socket.destroy();
  }
}
