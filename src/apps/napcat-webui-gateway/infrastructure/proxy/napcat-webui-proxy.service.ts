import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
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
import { NapcatWebuiGatewayConfigService } from '../../config/napcat-webui-gateway-config.service';
import type { NapcatWebuiGatewaySession } from '../../domain/napcat-webui-gateway.types';
import { NapcatWebuiCredentialClient } from '../napcat-webui-credential.client';

const INTERNAL_GATEWAY_WEBUI_PREFIX = '/napcat-webui/session';
const GATEWAY_BROWSER_TOKEN_PREFIX = 'kt-napcat-webui-gateway:';
const TEXT_REWRITE_EXTENSIONS = [
  '.css',
  '.html',
  '.js',
  '.mjs',
  '.webmanifest',
] as const;
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
  publicSessionPrefix: string;
  sessionId: string;
  upstreamBaseUrl: string;
};

type CookiePathRewriteInput = {
  publicSessionPrefix: string;
  sessionId: string;
};

type RewriteTextResponseInput = {
  body: string;
  publicSessionPrefix: string;
  sessionId: string;
};

type RewriteServiceWorkerAllowedInput = {
  allowedPath: string;
  publicSessionPrefix: string;
  requestPath: string;
  sessionId: string;
};

type RewriteWebSocketSearchInput = {
  credential: string;
  search: string;
  upstreamPath: string;
};

type ProxyRequestContext = {
  credential: string;
  session: NapcatWebuiGatewaySession;
};

/** 清理网关代理路径。 */
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

/** 返回重写NapCat位置请求头。 */
export function rewriteNapcatLocationHeader(input: RewriteLocationInput) {
  const gatewayPrefix = `${input.publicSessionPrefix}/${encodeURIComponent(
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

/** 构建网关Cookie路径重写。 */
export function buildGatewayCookiePathRewrite(input: CookiePathRewriteInput) {
  return {
    '*': `${input.publicSessionPrefix}/${encodeURIComponent(
      input.sessionId,
    )}/webui`,
  };
}

/** 返回重写NapCat集合Cookie请求头。 */
export function rewriteNapcatSetCookieHeaders(
  headers: string | string[] | undefined,
  input: CookiePathRewriteInput,
): string[] | undefined {
  if (!headers) return undefined;

  const cookiePath = buildGatewayCookiePathRewrite(input)['*'];
  const values = Array.isArray(headers) ? headers : [headers];
  return values.map((header) => {
    const withoutDomain = header.replace(/;\s*Domain=[^;]*/gi, '');
    if (/;\s*Path=[^;]*/i.test(withoutDomain)) {
      return withoutDomain.replace(/;\s*Path=[^;]*/i, `; Path=${cookiePath}`);
    }
    return `${withoutDomain}; Path=${cookiePath}`;
  });
}

/** 返回重写NapCat服务工作进程允许的请求头。 */
export function rewriteNapcatServiceWorkerAllowedHeader(
  input: RewriteServiceWorkerAllowedInput,
) {
  const gatewayWebuiPrefix = `${input.publicSessionPrefix}/${encodeURIComponent(
    input.sessionId,
  )}/webui`;

  try {
    const requestPath = sanitizeGatewayProxyPath(input.requestPath);
    const namespacePath = getServiceWorkerNamespacePath(requestPath);
    if (!namespacePath) return undefined;

    const requestUrl = new URL(requestPath, 'http://gateway.local');
    const allowedUrl = new URL(input.allowedPath, requestUrl);
    if (allowedUrl.origin !== requestUrl.origin) return undefined;

    const allowedPath = sanitizeGatewayProxyPath(allowedUrl.pathname);
    if (
      /[\u0000-\u001f\u007f]/.test(allowedPath) ||
      !allowedPath.startsWith(namespacePath)
    ) {
      return undefined;
    }

    return `${gatewayWebuiPrefix}${allowedUrl.pathname}`;
  } catch {
    return undefined;
  }
}

/** 读取服务工作进程命名空间路径。 */
function getServiceWorkerNamespacePath(requestPath: string) {
  const segments = requestPath.split('/').filter(Boolean);
  if (segments[0] === 'webui') {
    return '/webui/';
  }
  if (
    segments[0] === 'plugin' &&
    segments[1] &&
    (segments[2] === 'files' || segments[2] === 'mem')
  ) {
    return `/plugin/${segments[1]}/`;
  }
  return undefined;
}

/** 返回重写NapCat文本响应。 */
export function rewriteNapcatTextResponse(input: RewriteTextResponseInput) {
  const gatewayWebuiPrefix = `${input.publicSessionPrefix}/${encodeURIComponent(
    input.sessionId,
  )}/webui`;

  const rewritten = input.body.replace(
    /(^|[\s"'`(=,:}])\/(webui|api|files|plugin)(?=\/|[?#"'`)]|$)/g,
    (_match, leader: string, root: string) =>
      `${leader}${gatewayWebuiPrefix}/${root}`,
  );

  return injectGatewayBrowserToken({
    body: rewritten,
    sessionId: input.sessionId,
  });
}

/** 返回重写NapCatWeb套接字搜索。 */
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

/** 注入网关浏览器令牌。 */
function injectGatewayBrowserToken(
  input: Pick<RewriteTextResponseInput, 'body' | 'sessionId'>,
) {
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

  return input.body.replace(/<script\b/i, `${script}<script`);
}

/** 构建网关浏览器令牌脚本。 */
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

/** 解码代理路径。 */
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

/** 返回到网关重定向位置。 */
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

/** 判断是否应当重写NapCat文本响应。 */
export function shouldRewriteNapcatTextResponse(upstreamPath: string) {
  const pathname = new URL(upstreamPath, 'http://gateway.local').pathname;
  const segments = pathname.split('/').filter(Boolean);
  const isCoreApiPath = segments[0] === 'api';
  const isLegacyPluginPage =
    segments[0] === 'api' &&
    segments[1] === 'Plugin' &&
    segments[2] === 'page' &&
    segments.length >= 5;
  const isPluginPath = segments[0] === 'plugin' && segments.length >= 3;
  const pluginRoute = isPluginPath ? segments[2] : undefined;

  if (isLegacyPluginPage) {
    return true;
  }

  if (isCoreApiPath || pluginRoute === 'api') {
    return false;
  }

  if (pluginRoute === 'page') {
    return true;
  }

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
  private readonly boundWebSocketServers = new WeakSet<Server>();
  private readonly proxyRequestContexts = new WeakMap<
    IncomingMessage,
    ProxyRequestContext
  >();
  private readonly streamingHttpProxy: RequestHandler<
    Request,
    Response,
    NextFunction
  >;
  private readonly textHttpProxy: RequestHandler<
    Request,
    Response,
    NextFunction
  >;
  private readonly webSocketProxy: RequestHandler<
    Request,
    Response,
    NextFunction
  >;

  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly credentialClient: NapcatWebuiCredentialClient,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {
    this.streamingHttpProxy = this.createProxy();
    this.textHttpProxy = this.createProxy(true);
    this.webSocketProxy = this.createProxy(false, true);
  }

  /** 处理HTTP代理。 */
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
    this.proxyRequestContexts.set(req, { credential, session });

    const proxy = shouldRewriteNapcatTextResponse(upstreamPath)
      ? this.textHttpProxy
      : this.streamingHttpProxy;
    return proxy(req, res, next);
  }

  /** 绑定Web套接字升级。 */
  bindWebSocketUpgrade(server: Server) {
    if (this.boundWebSocketServers.has(server)) return;
    this.boundWebSocketServers.add(server);
    server.on('upgrade', (req, socket, head) => {
      void this.handleWebSocketUpgrade(req, socket as Socket, head);
    });
  }

  /** 处理Web套接字升级。 */
  private async handleWebSocketUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ) {
    try {
      const match = this.matchGatewayUpgrade(req.url || '');
      if (!match) {
        this.rejectUpgrade(socket);
        return;
      }
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
      this.proxyRequestContexts.set(req, { credential, session });
      this.webSocketProxy.upgrade(req, socket, head);
    } catch {
      this.rejectUpgrade(socket);
    }
  }

  /** 创建代理。 */
  private createProxy(
    rewriteTextResponse = false,
    webSocketOnly = false,
  ): RequestHandler<Request, Response, NextFunction> {
    return createProxyMiddleware<Request, Response, NextFunction>({
      changeOrigin: true,
      on: {
        error: (_error, _req, res) => {
          this.writeProxyError(res);
        },
        proxyReq: (proxyReq, req) => {
          const { credential } = this.requireProxyRequestContext(req);
          proxyReq.removeHeader('cookie');
          proxyReq.setHeader('Authorization', `Bearer ${credential}`);
          fixRequestBody(proxyReq, req);
        },
        proxyReqWs: (proxyReq, req) => {
          const { credential } = this.requireProxyRequestContext(req);
          proxyReq.removeHeader('cookie');
          proxyReq.setHeader('Authorization', `Bearer ${credential}`);
        },
        proxyRes: this.createProxyResponseHandler(rewriteTextResponse),
      },
      router: (req) =>
        this.requireProxyRequestContext(req).session.upstreamBaseUrl,
      secure: false,
      selfHandleResponse: rewriteTextResponse,
      target: 'http://127.0.0.1',
      ws: webSocketOnly,
    });
  }

  /** 创建代理响应处理器。 */
  private createProxyResponseHandler(rewriteTextResponse: boolean) {
    if (!rewriteTextResponse) {
      return (proxyRes: IncomingMessage, req: Request) => {
        const { session } = this.requireProxyRequestContext(req);
        this.rewriteResponseHeaders(proxyRes.headers, session, req.url);
      };
    }

    const interceptTextResponse = responseInterceptor<
      IncomingMessage,
      Response
    >(async (responseBuffer, _proxyRes, req) => {
      const { session } = this.requireProxyRequestContext(req);
      return rewriteNapcatTextResponse({
        body: responseBuffer.toString('utf8'),
        publicSessionPrefix: this.config.publicSessionPrefix(),
        sessionId: session.sessionId,
      });
    });

    return (proxyRes: IncomingMessage, req: Request, res: Response) => {
      const { session } = this.requireProxyRequestContext(req);
      this.rewriteResponseHeaders(proxyRes.headers, session, req.url);
      return interceptTextResponse(proxyRes, req, res);
    };
  }

  /** 返回必需代理请求上下文。 */
  private requireProxyRequestContext(req: IncomingMessage) {
    const context = this.proxyRequestContexts.get(req);
    if (!context) {
      throw new Error('NapCat WebUI proxy request context is missing');
    }
    return context;
  }

  /** 返回重写响应请求头。 */
  private rewriteResponseHeaders(
    headers: IncomingHttpHeaders,
    session: NapcatWebuiGatewaySession,
    requestPath: string,
  ) {
    const publicSessionPrefix = this.config.publicSessionPrefix();
    const location = headers.location;
    if (typeof location === 'string') {
      headers.location = rewriteNapcatLocationHeader({
        location,
        publicSessionPrefix,
        sessionId: session.sessionId,
        upstreamBaseUrl: session.upstreamBaseUrl,
      });
    }
    if (headers['service-worker-allowed'] !== undefined) {
      const allowedPath = headers['service-worker-allowed'];
      const rewrittenAllowedPath = rewriteNapcatServiceWorkerAllowedHeader({
        allowedPath: Array.isArray(allowedPath)
          ? String(allowedPath[0] || '')
          : String(allowedPath),
        publicSessionPrefix,
        requestPath,
        sessionId: session.sessionId,
      });
      if (rewrittenAllowedPath) {
        headers['service-worker-allowed'] = rewrittenAllowedPath;
      } else {
        delete headers['service-worker-allowed'];
      }
    }
    const setCookieHeaders = rewriteNapcatSetCookieHeaders(
      headers['set-cookie'],
      {
        publicSessionPrefix,
        sessionId: session.sessionId,
      },
    );
    if (setCookieHeaders) {
      headers['set-cookie'] = setCookieHeaders;
    } else {
      delete headers['set-cookie'];
    }
  }

  /** 构建上游路径。 */
  private buildUpstreamPath(proxyPath: ProxyPathInput, originalUrl?: string) {
    const pathname = sanitizeGatewayProxyPath(proxyPath);
    const queryIndex = String(originalUrl || '').indexOf('?');
    const query = queryIndex >= 0 ? String(originalUrl).slice(queryIndex) : '';
    return `${pathname}${query}`;
  }

  /** 匹配网关升级。 */
  private matchGatewayUpgrade(rawUrl: string) {
    const url = new URL(rawUrl, 'http://gateway.local');
    const match = url.pathname.match(
      new RegExp(`^${INTERNAL_GATEWAY_WEBUI_PREFIX}/([^/]+)/webui(?:/(.*))?$`),
    );
    if (!match) return undefined;

    return {
      proxyPath: sanitizeGatewayProxyPath(match[2] || ''),
      search: url.search,
      sessionId: decodeURIComponent(match[1]),
    };
  }

  /** 移除浏览器请求头。 */
  private stripBrowserHeaders(req: IncomingMessage) {
    STRIPPED_UPSTREAM_HEADERS.forEach((header) => {
      delete req.headers[header];
    });
  }

  /** 写入代理错误。 */
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

  /** 返回拒绝升级。 */
  private rejectUpgrade(socket: Socket) {
    if (socket.writable) {
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    }
    socket.destroy();
  }
}
