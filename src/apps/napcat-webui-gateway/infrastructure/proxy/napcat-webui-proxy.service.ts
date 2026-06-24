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

/**
 * Normalizes a Gateway route tail into a safe upstream pathname.
 * @param input - Route parameter from Nest/path-to-regexp.
 * @returns Absolute upstream pathname beginning with `/`.
 */
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

/**
 * Rewrites NapCat redirects so browsers stay under the Gateway session route.
 * @param input - Upstream Location header plus Gateway session context.
 * @returns Rewritten safe Location header.
 */
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

/**
 * Builds HPM cookie path rewrite config for Gateway-scoped upstream cookies.
 * @param input - Gateway session id used in the public route prefix.
 * @returns HPM cookiePathRewrite object.
 */
export function buildGatewayCookiePathRewrite(input: CookiePathRewriteInput) {
  return {
    '*': `${GATEWAY_WEBUI_PREFIX}/${encodeURIComponent(input.sessionId)}/webui`,
  };
}

/**
 * Rewrites absolute NapCat WebUI browser paths so assets, APIs, and plugin resources stay under the active Gateway session.
 * @param input - Text response body from NapCat plus the Gateway session id that owns the browser lifecycle.
 * @returns Body text whose absolute NapCat root paths point back through the Gateway session prefix.
 */
export function rewriteNapcatTextResponse(input: RewriteTextResponseInput) {
  const gatewayWebuiPrefix = `${GATEWAY_WEBUI_PREFIX}/${encodeURIComponent(
    input.sessionId,
  )}/webui`;

  return input.body.replace(
    /(^|[\s"'`(=,:])\/(webui|api|File|plugin)(?=\/|[?#"'`)]|$)/g,
    (_match, leader: string, root: string) =>
      `${leader}${gatewayWebuiPrefix}/${root}`,
  );
}

/**
 * Decodes path text until stable so nested encoded traversal cannot pass through.
 * @param value - Raw route path text.
 * @returns Decoded path text.
 */
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

/**
 * Builds a browser redirect that keeps only the upstream pathname.
 * @param gatewayPrefix - Public Gateway session route prefix for one Admin session.
 * @param upstreamPathname - Upstream redirect pathname after URL parsing removed search/hash.
 * @returns Gateway-scoped Location header, falling back to WebUI root for unsafe paths.
 */
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

/**
 * Checks whether a proxied upstream path may contain browser-executable absolute paths that need Gateway prefix rewriting.
 * @param upstreamPath - Sanitized upstream pathname with an optional query string.
 * @returns Whether the response should be buffered for text rewriting.
 */
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
  /**
   * Creates the Gateway proxy service.
   * @param sessionService - Session lifecycle guard for bootstrap/proxy eligibility.
   * @param credentialClient - NapCat WebUI credential exchange/cache client.
   */
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly credentialClient: NapcatWebuiCredentialClient,
  ) {}

  /**
   * Proxies one HTTP request to the active session's NapCat WebUI.
   * @param sessionId - Gateway session id from the public route.
   * @param proxyPath - Route tail mapped to the upstream pathname.
   * @param req - Express request delegated from the public controller.
   * @param res - Express response owned by HPM after delegation.
   * @param next - Express next callback used by HPM.
   */
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

  /**
   * Subscribes the Gateway HTTP server to NapCat WebUI WebSocket upgrades.
   * @param server - HTTP server returned by the Nest application.
   */
  bindWebSocketUpgrade(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      void this.handleWebSocketUpgrade(req, socket as Socket, head);
    });
  }

  /**
   * Handles one matching WebSocket upgrade and ignores unrelated upgrade URLs.
   * @param req - Raw Node upgrade request.
   * @param socket - TCP socket for the upgrade.
   * @param head - First packet of the upgraded stream.
   */
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
      req.url = `${match.proxyPath}${match.search}`;
      const proxy = this.createProxy(session, credential);
      proxy.upgrade(req, socket, head);
    } catch {
      this.rejectUpgrade(socket);
    }
  }

  /**
   * Creates one HPM proxy bound to a validated session and server-side credential.
   * @param session - Active Gateway session metadata.
   * @param credential - NapCat WebUI Credential for upstream Authorization.
   * @returns HPM request handler with HTTP and WebSocket support.
   */
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

  /**
   * Builds the upstream response handler and rewrites redirect headers before HPM copies them to Express.
   * @param session - Active Gateway session whose route prefix owns browser redirects.
   * @param rewriteTextResponse - Whether this response is buffered for body path rewriting.
   * @returns HPM proxy response handler.
   */
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

  /**
   * Rewrites one upstream Location header in-place so browser redirects remain inside the Gateway route.
   * @param headers - Upstream response headers exposed by HPM.
   * @param session - Active Gateway session whose public prefix should own redirects.
   */
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

  /**
   * Builds the upstream URL path while preserving the original query string.
   * @param proxyPath - Gateway route tail to sanitize.
   * @param originalUrl - Original Express URL containing the query string.
   * @returns Upstream path plus query string.
   */
  private buildUpstreamPath(proxyPath: ProxyPathInput, originalUrl?: string) {
    const pathname = sanitizeGatewayProxyPath(proxyPath);
    const queryIndex = String(originalUrl || '').indexOf('?');
    const query = queryIndex >= 0 ? String(originalUrl).slice(queryIndex) : '';
    return `${pathname}${query}`;
  }

  /**
   * Parses a public WebSocket upgrade URL into Gateway session and upstream path.
   * @param rawUrl - Raw URL from the Node upgrade request.
   * @returns Parsed session id, sanitized upstream path, and query string when matched.
   */
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

  /**
   * Removes browser-provided auth/session headers before HPM builds upstream requests.
   * @param req - Express or Node request whose headers are being proxied.
   */
  private stripBrowserHeaders(req: IncomingMessage) {
    STRIPPED_UPSTREAM_HEADERS.forEach((header) => {
      delete req.headers[header];
    });
  }

  /**
   * Writes a generic HTTP proxy failure without exposing upstream target data.
   * @param res - HTTP response object passed by HPM.
   */
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

  /**
   * Sends a compact HTTP error for failed WebSocket upgrade validation.
   * @param socket - Upgrade socket to close after the error response.
   */
  private rejectUpgrade(socket: Socket) {
    if (socket.writable) {
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    }
    socket.destroy();
  }
}
