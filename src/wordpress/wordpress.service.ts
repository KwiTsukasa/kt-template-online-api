import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response as ExpressResponse } from 'express';
import { throwVbenError } from '@/common';
import type {
  WordpressArticleBodyDto,
  WordpressArticleListQueryDto,
  WordpressTermBodyDto,
  WordpressTermListQueryDto,
} from './wordpress.dto';

export type WordpressAuthContext = {
  authorization?: string;
  cookie?: string;
  nonce?: string;
};

export type WordpressLoginResult = {
  auth: {
    nonce: string;
    type: 'cookie';
  };
  user: any;
};

export type WordpressOptionalLoginResult =
  | {
      available: false;
      error: WordpressAvailabilityError;
      result: null;
    }
  | {
      available: true;
      error: null;
      result: WordpressLoginResult & { cookie: string };
    };

export type WordpressAvailabilityError = {
  error: any;
  message: string;
  status: number;
};

type WordpressAvailabilityCache = {
  available: boolean;
  checkedAt: number;
  error?: WordpressAvailabilityError;
};

type WordpressRequestOptions = {
  auth: WordpressAuthContext;
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, unknown>;
};

type WordpressResponse<T> = {
  data: T;
  total?: number;
};

const WORDPRESS_COOKIE_PREFIXES = [
  'wordpress_',
  'wordpress_logged_in_',
  'wp-settings-',
  'wp-postpass_',
  'comment_author_',
];
const WORDPRESS_AUTH_COOKIE = 'kt_wordpress_auth';

@Injectable()
export class WordpressService {
  private availabilityCache: null | WordpressAvailabilityCache = null;

  constructor(private readonly configService: ConfigService) {}

  getAuthContext(request: Request): WordpressAuthContext {
    const authorization =
      this.readHeader(request, 'x-wordpress-authorization') ||
      this.readHeader(request, 'x-wp-authorization') ||
      this.getForwardableAuthorization(request);
    const nonce =
      this.readHeader(request, 'x-wp-nonce') ||
      this.readHeader(request, 'x-wordpress-nonce');
    const cookie =
      this.readHeader(request, 'x-wordpress-cookie') ||
      this.readCookie(request, WORDPRESS_AUTH_COOKIE) ||
      this.getWordpressCookie(request.headers.cookie);

    return {
      authorization,
      cookie,
      nonce,
    };
  }

  async checkAuth(auth: WordpressAuthContext) {
    const response = await this.request('/wp-json/wp/v2/users/me', {
      auth,
      query: {
        context: 'edit',
      },
    });

    return response.data;
  }

  async tryLoginWithConfiguredAdmin(): Promise<WordpressOptionalLoginResult> {
    try {
      const result = await this.loginWithConfiguredAdmin({
        timeoutMs: this.getLoginTimeout(),
      });
      this.rememberAvailability(true);

      return {
        available: true,
        error: null,
        result,
      };
    } catch (err) {
      const error = this.normalizeAvailabilityError(err);
      this.rememberAvailability(false, error);

      return {
        available: false,
        error,
        result: null,
      };
    }
  }

  isAdminIntegrationAvailable() {
    if (!this.availabilityCache) return true;
    if (
      Date.now() - this.availabilityCache.checkedAt >
      this.getAvailabilityTtl()
    ) {
      return true;
    }

    return this.availabilityCache.available;
  }

  async loginWithConfiguredAdmin(
    options: { timeoutMs?: number } = {},
  ): Promise<WordpressLoginResult & { cookie: string }> {
    const username = this.configService.get<string>('WORDPRESS_ADMIN_USERNAME');
    const password = this.configService.get<string>('WORDPRESS_ADMIN_PASSWORD');

    if (!username || !password) {
      throwVbenError(
        'WordPress 管理员账号未配置',
        HttpStatus.BAD_REQUEST,
        'WordPressConfigError',
      );
    }

    const cookie = await this.loginByPassword(
      username,
      password,
      options.timeoutMs,
    );
    const nonce = await this.fetchRestNonce(cookie, options.timeoutMs);

    if (!nonce) {
      throwVbenError(
        'WordPress 登录成功但未获取 REST nonce',
        HttpStatus.BAD_GATEWAY,
        'WordPressNonceError',
      );
    }

    const user = await this.checkAuth({
      cookie,
      nonce,
    });

    return {
      auth: {
        nonce,
        type: 'cookie',
      },
      cookie,
      user,
    };
  }

  setAuthCookie(res: ExpressResponse, cookie: string) {
    res.cookie(WORDPRESS_AUTH_COOKIE, cookie, {
      ...this.getCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  clearAuthCookie(res: ExpressResponse) {
    res.clearCookie(WORDPRESS_AUTH_COOKIE, this.getCookieOptions());
    res.clearCookie(WORDPRESS_AUTH_COOKIE, {
      ...this.getCookieOptions(),
      path: '/api/wordpress',
    });
    res.clearCookie(WORDPRESS_AUTH_COOKIE, {
      ...this.getCookieOptions(),
      path: '/wordpress',
    });
  }

  async articleList(
    query: WordpressArticleListQueryDto,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request<any[]>('/wp-json/wp/v2/posts', {
      auth,
      query: {
        ...this.getPageQuery(query),
        author: query.author,
        categories: this.normalizeIdQuery(query.categories),
        context: 'edit',
        search: query.search,
        status: query.status || 'any',
        tags: this.normalizeIdQuery(query.tags),
      },
    });

    return {
      list: response.data,
      total: response.total || 0,
    };
  }

  async articleDetail(id: string | number, auth: WordpressAuthContext) {
    const response = await this.request(`/wp-json/wp/v2/posts/${id}`, {
      auth,
      query: {
        context: 'edit',
      },
    });

    return response.data;
  }

  async articleSave(body: WordpressArticleBodyDto, auth: WordpressAuthContext) {
    const response = await this.request('/wp-json/wp/v2/posts', {
      auth,
      body: this.getArticleBody(body),
      method: 'POST',
    });

    return response.data;
  }

  async articleUpdate(
    body: WordpressArticleBodyDto & { id: number },
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`/wp-json/wp/v2/posts/${body.id}`, {
      auth,
      body: this.getArticleBody(body),
      method: 'POST',
    });

    return response.data;
  }

  async articleRemove(
    id: string | number,
    force: boolean,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`/wp-json/wp/v2/posts/${id}`, {
      auth,
      method: 'DELETE',
      query: {
        force,
      },
    });

    return response.data;
  }

  async tagList(query: WordpressTermListQueryDto, auth: WordpressAuthContext) {
    return this.termList('/wp-json/wp/v2/tags', query, auth);
  }

  async tagDetail(id: string | number, auth: WordpressAuthContext) {
    return this.termDetail('/wp-json/wp/v2/tags', id, auth);
  }

  async tagSave(body: WordpressTermBodyDto, auth: WordpressAuthContext) {
    return this.termSave('/wp-json/wp/v2/tags', body, auth);
  }

  async tagUpdate(
    body: WordpressTermBodyDto & { id: number },
    auth: WordpressAuthContext,
  ) {
    return this.termUpdate('/wp-json/wp/v2/tags', body, auth);
  }

  async tagRemove(
    id: string | number,
    force: boolean,
    auth: WordpressAuthContext,
  ) {
    return this.termRemove('/wp-json/wp/v2/tags', id, force, auth);
  }

  async categoryList(
    query: WordpressTermListQueryDto,
    auth: WordpressAuthContext,
  ) {
    return this.termList('/wp-json/wp/v2/categories', query, auth);
  }

  async categoryDetail(id: string | number, auth: WordpressAuthContext) {
    return this.termDetail('/wp-json/wp/v2/categories', id, auth);
  }

  async categorySave(body: WordpressTermBodyDto, auth: WordpressAuthContext) {
    return this.termSave('/wp-json/wp/v2/categories', body, auth);
  }

  async categoryUpdate(
    body: WordpressTermBodyDto & { id: number },
    auth: WordpressAuthContext,
  ) {
    return this.termUpdate('/wp-json/wp/v2/categories', body, auth);
  }

  async categoryRemove(
    id: string | number,
    force: boolean,
    auth: WordpressAuthContext,
  ) {
    return this.termRemove('/wp-json/wp/v2/categories', id, force, auth);
  }

  private async termList(
    path: string,
    query: WordpressTermListQueryDto,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request<any[]>(path, {
      auth,
      query: {
        ...this.getPageQuery(query),
        context: 'edit',
        hide_empty: query.hide_empty,
        parent: query.parent,
        search: query.search,
      },
    });

    return {
      list: response.data,
      total: response.total || 0,
    };
  }

  private async termDetail(
    path: string,
    id: string | number,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`${path}/${id}`, {
      auth,
      query: {
        context: 'edit',
      },
    });

    return response.data;
  }

  private async termSave(
    path: string,
    body: WordpressTermBodyDto,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(path, {
      auth,
      body: this.getTermBody(body),
      method: 'POST',
    });

    return response.data;
  }

  private async termUpdate(
    path: string,
    body: WordpressTermBodyDto & { id: number },
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`${path}/${body.id}`, {
      auth,
      body: this.getTermBody(body),
      method: 'POST',
    });

    return response.data;
  }

  private async termRemove(
    path: string,
    id: string | number,
    force: boolean,
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`${path}/${id}`, {
      auth,
      method: 'DELETE',
      query: {
        force,
      },
    });

    return response.data;
  }

  private async request<T>(
    path: string,
    options: WordpressRequestOptions,
  ): Promise<WordpressResponse<T>> {
    this.assertAuthContext(options.auth);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.getTimeout());

    try {
      const urls = this.getRequestUrls(path, options.query);

      for (let index = 0; index < urls.length; index += 1) {
        let response = await fetch(urls[index], {
          body: options.body ? JSON.stringify(options.body) : undefined,
          headers: this.getHeaders(options.auth, !!options.body),
          method: options.method || 'GET',
          redirect: 'follow',
          signal: controller.signal,
        });
        let data = await this.parseResponse(response);

        // 部分 WordPress 网关会拦截 DELETE；REST API 官方支持用 _method=DELETE 通过 POST 兜底。
        if (!response.ok && response.status === 405 && options.method === 'DELETE') {
          response = await fetch(this.getMethodOverrideUrl(urls[index], 'DELETE'), {
            headers: this.getHeaders(options.auth, false),
            method: 'POST',
            redirect: 'follow',
            signal: controller.signal,
          });
          data = await this.parseResponse(response);
        }

        // 兼容未开启 Apache rewrite 的 WordPress：/wp-json 404 时自动回退到 ?rest_route=。
        if (
          !response.ok &&
          response.status === 404 &&
          index < urls.length - 1
        ) {
          continue;
        }

        if (!response.ok) {
          throwVbenError(
            this.getErrorMessage(data, response.status),
            response.status,
            data,
          );
        }

        return {
          data: data as T,
          total: Number(response.headers.get('x-wp-total') || 0),
        };
      }

      throwVbenError('WordPress 请求失败', HttpStatus.BAD_GATEWAY);
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throwVbenError('WordPress 请求超时', HttpStatus.GATEWAY_TIMEOUT);
      }

      this.throwWordpressNetworkError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private async loginByPassword(
    username: string,
    password: string,
    timeoutMs?: number,
  ) {
    const response = await this.formRequest(
      '/wp-login.php',
      {
        log: username,
        pwd: password,
        redirect_to: this.getUrl('/wp-admin/'),
        testcookie: '1',
        'wp-submit': 'Log In',
      },
      timeoutMs,
    );
    const setCookies = this.getSetCookieHeaders(response.headers);
    const cookie = this.toCookieHeader(setCookies);

    if (!cookie || !/wordpress_(?:logged_in|sec)_/i.test(cookie)) {
      const body = await response.text().catch(() => '');
      throwVbenError(
        this.getLoginErrorMessage(body),
        HttpStatus.UNAUTHORIZED,
        'WordPressLoginError',
      );
    }

    return cookie;
  }

  private async fetchRestNonce(cookie: string, timeoutMs?: number) {
    const adminPaths = [
      '/wp-admin/',
      '/wp-admin/post-new.php',
      '/wp-admin/edit.php',
    ];

    for (const path of adminPaths) {
      const response = await this.rawRequest(
        path,
        {
          headers: {
            Cookie: cookie,
          },
        },
        timeoutMs,
      );
      const html = await response.text().catch(() => '');
      const nonce = this.extractRestNonce(html);

      if (nonce) return nonce;
    }

    return '';
  }

  private async formRequest(
    path: string,
    body: Record<string, string>,
    timeoutMs?: number,
  ) {
    const form = new URLSearchParams(body);

    return this.rawRequest(
      path,
      {
        body: form,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: 'wordpress_test_cookie=WP Cookie check',
        },
        method: 'POST',
        redirect: 'manual',
      },
      timeoutMs,
    );
  }

  private async rawRequest(
    path: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs || this.getTimeout(),
    );

    try {
      return await fetch(this.getUrl(path), {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throwVbenError('WordPress 请求超时', HttpStatus.GATEWAY_TIMEOUT);
      }

      this.throwWordpressNetworkError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private assertAuthContext(auth: WordpressAuthContext) {
    const hasToken = !!auth.authorization;
    const hasCookieLogin = !!auth.cookie && !!auth.nonce;

    if (hasToken || hasCookieLogin) return;

    throwVbenError(
      '缺少 WordPress 客户端登录态',
      HttpStatus.UNAUTHORIZED,
      'WordPressUnauthorized',
    );
  }

  private getHeaders(auth: WordpressAuthContext, hasBody: boolean) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (auth.authorization) {
      headers.Authorization = auth.authorization;
    }

    if (auth.cookie) {
      headers.Cookie = auth.cookie;
    }

    if (auth.nonce) {
      headers['X-WP-Nonce'] = auth.nonce;
    }

    return headers;
  }

  private getCookieOptions() {
    const secure =
      this.configService.get<string>('ADMIN_COOKIE_SECURE') === 'true';

    return {
      httpOnly: true,
      path: '/',
      sameSite: secure ? ('none' as const) : ('lax' as const),
      secure,
    };
  }

  private getUrl(path: string, query?: Record<string, unknown>) {
    const baseUrl = this.configService.get<string>('WORDPRESS_BASE_URL');

    if (!baseUrl) {
      throwVbenError(
        'WORDPRESS_BASE_URL 未配置',
        HttpStatus.BAD_REQUEST,
        'WordPressConfigError',
      );
    }

    const url = new URL(`${baseUrl.replace(/\/+$/g, '')}${path}`);

    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, `${value}`);
    });

    return url.toString();
  }

  private getRequestUrls(path: string, query?: Record<string, unknown>) {
    const urls = [this.getUrl(path, query)];

    if (path.startsWith('/wp-json/')) {
      urls.push(this.getRestRouteUrl(path, query));
    }

    return urls;
  }

  private getRestRouteUrl(path: string, query?: Record<string, unknown>) {
    const restRoute = path.replace(/^\/wp-json/, '') || '/';
    const url = new URL(this.getUrl('/', query));

    url.searchParams.set('rest_route', restRoute);

    return url.toString();
  }

  private getMethodOverrideUrl(url: string, method: 'DELETE') {
    const overrideUrl = new URL(url);

    overrideUrl.searchParams.set('_method', method);

    return overrideUrl.toString();
  }

  private getTimeout() {
    return Number(this.configService.get('WORDPRESS_TIMEOUT_MS') || 15000);
  }

  private getLoginTimeout() {
    return Number(
      this.configService.get('WORDPRESS_LOGIN_TIMEOUT_MS') ||
        this.configService.get('WORDPRESS_TIMEOUT_MS') ||
        3000,
    );
  }

  private getAvailabilityTtl() {
    return Number(
      this.configService.get('WORDPRESS_AVAILABILITY_TTL_MS') || 60_000,
    );
  }

  private rememberAvailability(
    available: boolean,
    error?: WordpressAvailabilityError,
  ) {
    this.availabilityCache = {
      available,
      checkedAt: Date.now(),
      error,
    };
  }

  private getPageQuery(query: WordpressPagedQueryDto) {
    return {
      order: query.order,
      orderby: query.orderby,
      page: Number(query.pageNo || 1),
      per_page: Number(query.pageSize || 10),
    };
  }

  private getArticleBody(body: WordpressArticleBodyDto) {
    return this.pickDefined({
      categories: this.normalizeIdList(body.categories),
      content: body.content,
      excerpt: body.excerpt,
      featured_media: body.featured_media,
      slug: body.slug,
      status: body.status,
      sticky: body.sticky,
      tags: this.normalizeIdList(body.tags),
      title: body.title,
    });
  }

  private getTermBody(body: WordpressTermBodyDto) {
    return this.pickDefined({
      description: body.description,
      name: body.name,
      parent: body.parent,
      slug: body.slug,
    });
  }

  private normalizeIdList(value?: number[] | string) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return value;

    return value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => !Number.isNaN(item));
  }

  private normalizeIdQuery(value?: string | string[]) {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter(Boolean)
        .join(',');
    }

    if (typeof value !== 'string') return value;

    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(',');
  }

  private pickDefined(payload: Record<string, unknown>) {
    return Object.entries(payload).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          acc[key] = value;
        }

        return acc;
      },
      {},
    );
  }

  private async parseResponse(response: globalThis.Response) {
    const text = await response.text();

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private getErrorMessage(data: any, status: number) {
    if (data?.message) return data.message;
    if (typeof data === 'string' && data) return data;
    return `WordPress 请求失败：${status}`;
  }

  private throwWordpressNetworkError(err: unknown): never {
    const message = err instanceof Error ? err.message : '未知错误';
    const cause = this.getErrorCause(err);

    // fetch 的 DNS、连接拒绝等底层异常不是 HttpException，需要统一转成业务响应。
    return throwVbenError(
      cause
        ? `WordPress 网络请求失败：${message}（${cause}）`
        : `WordPress 网络请求失败：${message}`,
      HttpStatus.BAD_GATEWAY,
      {
        code: cause || 'WORDPRESS_NETWORK_ERROR',
        message,
        name: err instanceof Error ? err.name : 'Error',
      },
    );
  }

  private normalizeAvailabilityError(err: unknown): WordpressAvailabilityError {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      const responseBody =
        response && typeof response === 'object'
          ? (response as Record<string, any>)
          : {};

      return {
        error: responseBody.error || response,
        message:
          responseBody.message ||
          (typeof response === 'string' ? response : err.message),
        status: err.getStatus(),
      };
    }

    return {
      error: err instanceof Error ? err.name : 'WordPressUnavailable',
      message: err instanceof Error ? err.message : 'WordPress 暂不可用',
      status: HttpStatus.BAD_GATEWAY,
    };
  }

  private getErrorCause(err: unknown) {
    const cause = (err as { cause?: { code?: string; message?: string } })
      ?.cause;

    return cause?.code || cause?.message || '';
  }

  private getLoginErrorMessage(html: string) {
    const match = html.match(
      /<div[^>]*id=["']login_error["'][^>]*>([\s\S]*?)<\/div>/i,
    );

    if (!match?.[1]) return 'WordPress 管理员登录失败';

    return match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getSetCookieHeaders(headers: Headers) {
    const getSetCookie = (headers as any).getSetCookie;
    if (typeof getSetCookie === 'function') {
      return getSetCookie.call(headers) as string[];
    }

    const raw = (headers as any).raw?.()?.['set-cookie'];
    if (Array.isArray(raw)) return raw as string[];

    const setCookie = headers.get('set-cookie');
    if (!setCookie) return [];

    return this.splitSetCookieHeader(setCookie);
  }

  private splitSetCookieHeader(value: string) {
    return value.split(/,(?=\s*[^;,]+=)/).map((item) => item.trim());
  }

  private toCookieHeader(setCookies: string[]) {
    const cookies = setCookies
      .map((item) => item.split(';')[0]?.trim())
      .filter((item): item is string => {
        if (!item) return false;
        const [key] = item.split('=');

        return WORDPRESS_COOKIE_PREFIXES.some((prefix) =>
          key.startsWith(prefix),
        );
      });

    return cookies.join('; ');
  }

  private extractRestNonce(html: string) {
    const patterns = [
      /"nonce"\s*:\s*"([^"]+)"/i,
      /wpApiSettings\s*=\s*\{[\s\S]*?nonce["']?\s*:\s*["']([^"']+)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match?.[1]) {
        return match[1].replace(/\\\//g, '/');
      }
    }

    return '';
  }

  private readHeader(request: Request, name: string) {
    const value = request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private readCookie(request: Request, cookieName: string) {
    const cookieHeader = request.headers.cookie || '';
    const cookie = cookieHeader.split(';').find((item) => {
      const [key] = item.trim().split('=');
      return key === cookieName;
    });

    if (!cookie) return undefined;

    const [, ...value] = cookie.trim().split('=');

    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return value.join('=');
    }
  }

  private getForwardableAuthorization(request: Request) {
    const authorization = this.readHeader(request, 'authorization');

    if (!authorization || this.isLikelyAdminAuthorization(authorization)) {
      return undefined;
    }

    return authorization;
  }

  private isLikelyAdminAuthorization(authorization: string) {
    if (!authorization.startsWith('Bearer ')) return false;

    const token = authorization.replace(/^Bearer\s+/i, '');
    const [encodedPayload, signature, extra] = token.split('.');

    if (!encodedPayload || !signature || extra) return false;

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      );

      return payload?.type === 'access' || payload?.type === 'refresh';
    } catch {
      return false;
    }
  }

  private getWordpressCookie(cookieHeader?: string) {
    if (!cookieHeader) return undefined;

    // 只透传 WordPress 登录相关 cookie，避免把本系统 admin token 泄露给 WordPress。
    const cookies = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .filter((item) => {
        const [key] = item.split('=');
        return WORDPRESS_COOKIE_PREFIXES.some((prefix) =>
          key.startsWith(prefix),
        );
      });

    return cookies.length ? cookies.join('; ') : undefined;
  }
}

type WordpressPagedQueryDto =
  | WordpressArticleListQueryDto
  | WordpressTermListQueryDto;
