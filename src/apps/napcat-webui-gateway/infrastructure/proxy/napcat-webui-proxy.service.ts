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

/**
 * 解码并规范化网关代理路径，同时阻止反斜杠、协议地址和父目录穿越进入上游请求。
 * @param input - 路由捕获的单段或多段代理路径；数组按斜杠拼接后校验。
 * @returns 以单个斜杠开头、可安全转发给上游的路径。
 * @throws 路径为空、包含反斜杠或父目录段，或表现为双斜杠及协议地址时抛出 `BadRequestException`。
 */
export function sanitizeGatewayProxyPath(input: ProxyPathInput) {
  const raw = (() => {
    if (Array.isArray(input)) {
      return input.join('/');
    }
    return String(input || '');
  })();
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

  const path = (() => {
    if (decoded.startsWith('/')) {
      return decoded;
    }
    return `/${decoded}`;
  })();
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) {
    throw new BadRequestException('Gateway proxy path is invalid');
  }

  return path;
}

/**
 * 按边界规则转换NapCat位置请求头。
 * @param input - 用于按边界规则转换NapCat位置请求头的结构化输入，包含 `publicSessionPrefix`、`sessionId`、`location`、`upstreamBaseUrl` 字段。
 * @returns 按边界规则转换NapCat位置请求头。
 */
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

/**
 * 根据`input`构造网关Cookie路径重写。
 * @param input - 用于网关Cookie路径重写的结构化输入，包含 `publicSessionPrefix`、`sessionId` 字段。
 * @returns 包含 `*` 字段的网关Cookie路径重写。
 */
export function buildGatewayCookiePathRewrite(input: CookiePathRewriteInput) {
  return {
    '*': `${input.publicSessionPrefix}/${encodeURIComponent(
      input.sessionId,
    )}/webui`,
  };
}

/**
 * 按边界规则转换NapCat集合Cookie请求头。
 * @param headers - 决定按边界规则转换NapCat集合Cookie请求头内容、边界或目标的 `headers` 值。
 * @param input - 用于按边界规则转换NapCat集合Cookie请求头的结构化输入。
 * @returns 按输入顺序得到的按边界规则转换NapCat集合Cookie请求头列表；没有可用结果或提前结束时为 `undefined`，没有匹配项时为空数组。
 */
export function rewriteNapcatSetCookieHeaders(
  headers: string | string[] | undefined,
  input: CookiePathRewriteInput,
): string[] | undefined {
  if (!headers) return undefined;

  const cookiePath = buildGatewayCookiePathRewrite(input)['*'];
  const values = (() => {
    if (Array.isArray(headers)) {
      return headers;
    }
    return [headers];
  })();
  return values.map((header) => {
    const withoutDomain = header.replace(/;\s*Domain=[^;]*/gi, '');
    if (/;\s*Path=[^;]*/i.test(withoutDomain)) {
      return withoutDomain.replace(/;\s*Path=[^;]*/i, `; Path=${cookiePath}`);
    }
    return `${withoutDomain}; Path=${cookiePath}`;
  });
}

/**
 * 按边界规则转换NapCat服务工作进程允许的请求头。
 * @param input - 用于按边界规则转换NapCat服务工作进程允许的请求头的结构化输入，包含 `publicSessionPrefix`、`sessionId`、`requestPath`、`allowedPath` 字段。
 * @returns 按参数编码并拼接完成的按边界规则转换NapCat服务工作进程允许的请求头；没有可用结果或提前结束时为 `undefined`。
 */
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

/**
 * 按`requestPath`读取服务工作进程命名空间路径；当 `segments[0] === 'webui'` 成立时返回 `'/webui/'`。
 * @param requestPath - 必须保持在受控根目录内的路径。
 * @returns 当前状态对应的服务工作进程命名空间路径，取值为 `'/webui/'`；没有可用结果或提前结束时为 `undefined`。
 */
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

/**
 * 按边界规则转换NapCat文本响应。
 * @param input - 用于按边界规则转换NapCat文本响应的结构化输入，包含 `publicSessionPrefix`、`sessionId`、`body` 字段。
 * @returns 按边界规则转换NapCat文本响应。
 */
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

/**
 * 按边界规则转换NapCatWeb套接字搜索。
 * @param input - 用于按边界规则转换NapCatWeb套接字搜索的结构化输入，包含 `upstreamPath`、`search`、`credential` 字段。
 * @returns 当前状态对应的按边界规则转换NapCatWeb套接字搜索，取值为 `''`。
 */
export function rewriteNapcatWebSocketSearch(
  input: RewriteWebSocketSearchInput,
) {
  if (input.upstreamPath !== '/api/ws/terminal') {
    return input.search;
  }

  const params = new URLSearchParams(input.search);
  params.set('token', input.credential);
  const serialized = params.toString();
  if (serialized) {
    return `?${serialized}`;
  }
  return '';
}

/**
 * 根据`input`处理注入网关浏览器令牌；当 `input.body.includes('data-kt-napcat-webui-gateway-sso') || !/…` 成立时返回 `input.body`。
 * @param input - 用于注入网关浏览器令牌的结构化输入，包含 `body`、`sessionId` 字段。
 * @returns 注入网关浏览器令牌。
 */
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

/**
 * 根据`sessionId`构造网关浏览器令牌脚本。
 * @param sessionId - 用于精确定位会话的标识。
 * @returns 网关浏览器令牌脚本。
 */
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

/**
 * 对代理路径执行有界的重复 URI 解码，并拒绝无法稳定解码或包含非法编码的输入。
 * @param value - 待解码的代理路径；函数会在固定轮次内重复解码，直到内容稳定或判定非法。
 * @returns 代理路径。
 * @throws 任一轮 URI 解码失败，或达到最大轮次后内容仍未稳定时抛出 `BadRequestException`。
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
 * 将输入收敛并投影为网关重定向位置。
 * @param gatewayPrefix - 决定网关重定向位置内容、边界或目标的 `gatewayPrefix` 值。
 * @param upstreamPathname - 决定网关重定向位置内容、边界或目标的 `upstreamPathname` 值。
 * @returns 按参数编码并拼接完成的网关重定向位置。
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
 * 根据`upstreamPath`与当前约束判定是否应当重写NapCat文本响应；当 `isLegacyPluginPage` 成立时返回 `true`。
 * @param upstreamPath - 必须保持在受控根目录内的upstream路径。
 * @returns 满足是否应当重写NapCat文本响应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
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
  const pluginRoute = (() => {
    if (isPluginPath) {
      return segments[2];
    }
    return undefined;
  })();

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
    (() => {
      if (extensionIndex >= 0) {
        return filename.slice(extensionIndex).toLowerCase();
      }
      return '';
    })();

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

  /**
   * 根据`sessionId`、`proxyPath`、`req`处理HTTP代理；先通过 `sessionService.requireProxySession` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @param proxyPath - 必须保持在受控根目录内的代理路径。
   * @param req - 用于HTTP代理的当前 HTTP 请求，包含 `originalUrl`、`url` 字段。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @param next - 决定HTTP代理内容、边界或目标的 `next` 值。
   * @returns HTTP代理。
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
    this.proxyRequestContexts.set(req, { credential, session });

    const proxy = (() => {
      if (shouldRewriteNapcatTextResponse(upstreamPath)) {
        return this.textHttpProxy;
      }
      return this.streamingHttpProxy;
    })();
    return proxy(req, res, next);
  }

  /**
   * 根据`server`处理Web套接字升级。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   */
  bindWebSocketUpgrade(server: Server) {
    if (this.boundWebSocketServers.has(server)) return;
    this.boundWebSocketServers.add(server);
    server.on('upgrade', (req, socket, head) => {
      void this.handleWebSocketUpgrade(req, socket as Socket, head);
    });
  }

  /**
   * 根据`req`、`socket`、`head`处理Web套接字升级；当 `!match` 成立时直接结束且不产生返回值。
   * @param req - 用于Web套接字升级的当前 HTTP 请求，包含 `url` 字段。
   * @param socket - 决定Web套接字升级内容、边界或目标的 `socket` 值。
   * @param head - 决定Web套接字升级内容、边界或目标的 `head` 值。
   */
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

  /**
   * 根据`rewriteTextResponse`、`webSocketOnly`构造NapCat WebUI 上游代理处理器。
   * @param rewriteTextResponse - 是否缓冲并改写 NapCat 上游的文本响应；省略时默认采用 `false`。
   * @param webSocketOnly - 是否只接受 WebSocket 升级请求并跳过普通 HTTP 转发；省略时默认采用 `false`。
   * @returns NapCat WebUI 上游代理处理函数。
   */
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

  /**
   * 按响应类型选择流式透传处理器或缓冲文本后改写并重新计算响应头的处理器。
   * @param rewriteTextResponse - 是否缓冲并改写 NapCat 上游的文本响应。
   * @returns 按响应类型选择流式透传处理器或缓冲文本后改写并重新计算响应头的处理函数。
   */
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

  /**
   * 取得预先绑定到当前请求的代理凭据与会话，防止未经过准备阶段的请求进入转发流程。
   * @param req - 已在代理准备阶段登记上下文的 HTTP 请求。
   * @returns 与请求绑定的代理凭据和网关会话。
   * @throws 请求尚未登记代理上下文时抛出 `Error`。
   */
  private requireProxyRequestContext(req: IncomingMessage) {
    const context = this.proxyRequestContexts.get(req);
    if (!context) {
      throw new Error('NapCat WebUI proxy request context is missing');
    }
    return context;
  }

  /**
   * 按边界规则转换响应请求头。
   * @param headers - 用于按边界规则转换响应请求头的领域对象，包含 `location`、`'service-worker-allowed'`、`'set-cookie'` 字段。
   * @param session - 待读取、续期或持久化的按边界规则转换响应请求头会话。
   * @param requestPath - 必须保持在受控根目录内的路径。
   */
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
        allowedPath: (() => {
          if (Array.isArray(allowedPath)) {
            return String(allowedPath[0] || '');
          }
          return String(allowedPath);
        })(),
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

  /**
   * 根据`proxyPath`、`originalUrl`构造上游路径。
   * @param proxyPath - 必须保持在受控根目录内的代理路径。
   * @param originalUrl - 待规范化、请求或同源校验的originalURL 地址 URL；为空时采用 `''` 作为兜底。
   * @returns 按参数编码并拼接完成的上游路径。
   */
  private buildUpstreamPath(proxyPath: ProxyPathInput, originalUrl?: string) {
    const pathname = sanitizeGatewayProxyPath(proxyPath);
    const queryIndex = String(originalUrl || '').indexOf('?');
    const query = (() => {
      if (queryIndex >= 0) {
        return String(originalUrl).slice(queryIndex);
      }
      return '';
    })();
    return `${pathname}${query}`;
  }

  /**
   * 根据`rawUrl`处理匹配网关升级。
   * @param rawUrl - 待规范化、请求或同源校验的rawURL 地址 URL。
   * @returns 包含 `proxyPath`、`search`、`sessionId` 字段的匹配网关升级；没有可用结果或提前结束时为 `undefined`。
   */
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

  /**
   * 从`req`移除浏览器请求头，未命中标记时保留原输入。
   * @param req - 用于浏览器请求头的当前 HTTP 请求，包含 `headers` 字段。
   */
  private stripBrowserHeaders(req: IncomingMessage) {
    STRIPPED_UPSTREAM_HEADERS.forEach((header) => {
      delete req.headers[header];
    });
  }

  /**
   * 根据`res`更新代理错误；当 `'headersSent' in res` 成立时直接结束且不产生返回值。
   * @param res - 包含 `headersSent`、`status` 字段的上游服务响应。
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
   * 以统一异常拒绝升级。
   * @param socket - 用于以统一异常拒绝升级的领域对象，包含 `writable`、`write`、`destroy` 字段。
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
