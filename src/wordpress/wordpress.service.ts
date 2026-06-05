import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response as ExpressResponse } from 'express';
import { MarkdownService, throwVbenError, ToolsService } from '@/common';
import type {
  WordpressArticleBodyDto,
  WordpressArticleListQueryDto,
  WordpressTermBodyDto,
  WordpressTermListQueryDto,
} from './wordpress.dto';
import type {
  WordpressAuthContext,
  WordpressAvailabilityCache,
  WordpressAvailabilityError,
  WordpressLoginResult,
  WordpressOptionalLoginResult,
  WordpressPagedQueryDto,
  WordpressRequestOptions,
  WordpressResponse,
  WordpressArgonThemeConfig,
  WordpressArgonMenuItem,
} from './wordpress.types';

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

  constructor(
    private readonly configService: ConfigService,
    private readonly markdownService: MarkdownService,
    private readonly toolsService: ToolsService,
  ) {}

  getAuthContext(request: Request): WordpressAuthContext {
    const authorization =
      this.toolsService.readHeader(request, 'x-wordpress-authorization') ||
      this.toolsService.readHeader(request, 'x-wp-authorization') ||
      this.getForwardableAuthorization(request);
    const nonce =
      this.toolsService.readHeader(request, 'x-wp-nonce') ||
      this.toolsService.readHeader(request, 'x-wordpress-nonce');
    const cookie =
      this.toolsService.readHeader(request, 'x-wordpress-cookie') ||
      this.toolsService.readCookie(request, WORDPRESS_AUTH_COOKIE) ||
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
      list: response.data.map((item) => this.normalizeArticleResponse(item)),
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

    return this.normalizeArticleResponse(response.data);
  }

  async articleSave(body: WordpressArticleBodyDto, auth: WordpressAuthContext) {
    const response = await this.request('/wp-json/wp/v2/posts', {
      auth,
      body: await this.getArticleBody(body),
      method: 'POST',
    });

    return this.normalizeArticleResponse(response.data);
  }

  async articleUpdate(
    body: WordpressArticleBodyDto & { id: number },
    auth: WordpressAuthContext,
  ) {
    const response = await this.request(`/wp-json/wp/v2/posts/${body.id}`, {
      auth,
      body: await this.getArticleBody(body),
      method: 'POST',
    });

    return this.normalizeArticleResponse(response.data);
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

  async publicArticleList(query: WordpressArticleListQueryDto) {
    const response = await this.publicRequest<any[]>('/wp-json/wp/v2/posts', {
      query: {
        ...this.getPageQuery(query),
        _embed: 'author,wp:featuredmedia,wp:term',
        author: query.author,
        categories: this.normalizeIdQuery(query.categories),
        context: 'view',
        search: query.search,
        status: 'publish',
        tags: this.normalizeIdQuery(query.tags),
      },
    });

    return {
      list: response.data.map((item) => this.normalizeArticleResponse(item)),
      total: response.total || 0,
    };
  }

  async publicArticleDetail(query: { id?: string; slug?: string }) {
    if (query.id) {
      const response = await this.publicRequest(
        `/wp-json/wp/v2/posts/${query.id}`,
        {
          query: {
            _embed: 'author,wp:featuredmedia,wp:term',
            context: 'view',
          },
        },
      );

      return this.normalizeArticleResponse(response.data);
    }

    const slug = `${query.slug || ''}`.trim();
    if (!slug) {
      throwVbenError('文章别名不能为空', HttpStatus.BAD_REQUEST);
    }

    const response = await this.publicRequest<any[]>('/wp-json/wp/v2/posts', {
      query: {
        _embed: 'author,wp:featuredmedia,wp:term',
        context: 'view',
        per_page: 1,
        slug,
        status: 'publish',
      },
    });
    const [article] = response.data;

    if (!article) {
      throwVbenError('文章不存在或未发布', HttpStatus.NOT_FOUND);
    }

    return this.normalizeArticleResponse(article);
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

  async themeConfig(): Promise<WordpressArgonThemeConfig> {
    const [rootResponse, homeResponse] = await Promise.all([
      this.rawRequest('/?rest_route=/'),
      this.rawRequest('/'),
    ]);
    const root = await this.parseResponse(rootResponse);
    const html = await homeResponse.text();

    return this.parseArgonThemeConfig(html, root);
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

    return this.executeJsonRequest(path, options);
  }

  private async publicRequest<T>(
    path: string,
    options: Omit<WordpressRequestOptions, 'auth'> = {},
  ): Promise<WordpressResponse<T>> {
    return this.executeJsonRequest(path, options);
  }

  private async executeJsonRequest<T>(
    path: string,
    options: WordpressRequestOptions,
  ): Promise<WordpressResponse<T>> {
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
        if (
          !response.ok &&
          response.status === 405 &&
          options.method === 'DELETE'
        ) {
          response = await fetch(
            this.getMethodOverrideUrl(urls[index], 'DELETE'),
            {
              headers: this.getHeaders(options.auth, false),
              method: 'POST',
              redirect: 'follow',
              signal: controller.signal,
            },
          );
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
            this.getWordpressResponseErrorMessage(data, response.status),
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

  private assertAuthContext(auth?: WordpressAuthContext) {
    const hasToken = !!auth?.authorization;
    const hasCookieLogin = !!auth?.cookie && !!auth?.nonce;

    if (hasToken || hasCookieLogin) return;

    throwVbenError(
      '缺少 WordPress 客户端登录态',
      HttpStatus.UNAUTHORIZED,
      'WordPressUnauthorized',
    );
  }

  private getHeaders(auth: WordpressAuthContext | undefined, hasBody: boolean) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (auth?.authorization) {
      headers.Authorization = auth.authorization;
    }

    if (auth?.cookie) {
      headers.Cookie = auth.cookie;
    }

    if (auth?.nonce) {
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

  private async getArticleBody(body: WordpressArticleBodyDto) {
    return this.toolsService.pickDefined({
      categories: this.normalizeIdList(body.categories),
      content: await this.getArticleContent(body),
      excerpt: body.excerpt,
      featured_media: body.featured_media,
      slug: body.slug,
      status: body.status,
      sticky: body.sticky,
      tags: this.normalizeIdList(body.tags),
      title: body.title,
    });
  }

  private async getArticleContent(body: WordpressArticleBodyDto) {
    if (body.content === undefined) return undefined;
    if (body.contentFormat !== 'markdown') return body.content;

    const html = await this.markdownService.renderToHtml(body.content);
    return this.markdownService.embedSourceHtml(html, body.content);
  }

  private normalizeArticleResponse(article: Record<string, any>) {
    const content = article?.content;
    const contentValue =
      typeof content === 'string'
        ? content
        : content?.raw || content?.rendered || '';
    const contentMarkdown = this.markdownService.extractSource(contentValue);
    const contentHtml = this.markdownService.stripSourceMarker(contentValue);

    const nextArticle: Record<string, any> = {
      ...article,
      authorName: this.getEmbeddedAuthorName(article),
      categoriesResolved: this.getEmbeddedTerms(article, 'category'),
      contentHtml,
      cover: this.getEmbeddedFeaturedMediaUrl(article),
      excerptText: this.stripHtml(article?.excerpt?.rendered || article?.excerpt),
      tagsResolved: this.getEmbeddedTerms(article, 'post_tag'),
    };

    if (contentMarkdown) {
      nextArticle.contentMarkdown = contentMarkdown;
    }

    if (typeof content === 'string') {
      nextArticle.content = this.markdownService.stripSourceMarker(content);
      return nextArticle;
    }

    nextArticle.content = {
      ...content,
      raw: content.raw
        ? this.markdownService.stripSourceMarker(content.raw)
        : content.raw,
      rendered: content.rendered
        ? this.markdownService.stripSourceMarker(content.rendered)
        : content.rendered,
    };

    return nextArticle;
  }

  private getEmbeddedTerms(article: Record<string, any>, taxonomy: string) {
    const terms = article?._embedded?.['wp:term'];
    if (!Array.isArray(terms)) return [];

    return terms
      .flat()
      .filter((item) => item?.taxonomy === taxonomy)
      .map((item) =>
        this.toolsService.pickDefined({
          count: item.count,
          id: item.id,
          name: this.decodeHtmlEntities(item.name || ''),
          slug: item.slug,
        }),
      );
  }

  private getEmbeddedAuthorName(article: Record<string, any>) {
    const [author] = article?._embedded?.author || [];

    return this.decodeHtmlEntities(author?.name || '');
  }

  private getEmbeddedFeaturedMediaUrl(article: Record<string, any>) {
    const [media] = article?._embedded?.['wp:featuredmedia'] || [];

    return (
      media?.media_details?.sizes?.large?.source_url ||
      media?.media_details?.sizes?.full?.source_url ||
      media?.source_url ||
      ''
    );
  }

  private stripHtml(value: unknown) {
    return this.decodeHtmlEntities(`${value ?? ''}`)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getTermBody(body: WordpressTermBodyDto) {
    return this.toolsService.pickDefined({
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

  private async parseResponse(response: globalThis.Response) {
    const text = await response.text();

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private parseArgonThemeConfig(
    html: string,
    root: any,
  ): WordpressArgonThemeConfig {
    const argonConfigBlock = this.getScriptObjectBlock(html, 'argonConfig');

    return {
      argonConfig: {
        codeHighlight: {
          breakLine: this.getJsObjectBoolean(
            this.getJsObjectBlock(argonConfigBlock, 'code_highlight'),
            'break_line',
            false,
          ),
          enable: this.getJsObjectBoolean(
            this.getJsObjectBlock(argonConfigBlock, 'code_highlight'),
            'enable',
            false,
          ),
          hideLinenumber: this.getJsObjectBoolean(
            this.getJsObjectBlock(argonConfigBlock, 'code_highlight'),
            'hide_linenumber',
            false,
          ),
          transparentLinenumber: this.getJsObjectBoolean(
            this.getJsObjectBlock(argonConfigBlock, 'code_highlight'),
            'transparent_linenumber',
            false,
          ),
        },
        dateFormat: this.getJsObjectString(
          argonConfigBlock,
          'dateFormat',
          'YMD',
        ),
        disablePjax: this.getJsObjectBoolean(
          argonConfigBlock,
          'disable_pjax',
          false,
        ),
        foldLongComments: this.getJsObjectBoolean(
          argonConfigBlock,
          'fold_long_comments',
          false,
        ),
        foldLongShuoshuo: this.getJsObjectBoolean(
          argonConfigBlock,
          'fold_long_shuoshuo',
          false,
        ),
        headroom: this.getJsObjectRawValue(argonConfigBlock, 'headroom') || '',
        language: this.getJsObjectString(argonConfigBlock, 'language', ''),
        lazyload: {
          effect: this.getJsObjectString(
            this.getJsObjectBlock(argonConfigBlock, 'lazyload'),
            'effect',
            '',
          ),
          threshold: this.getJsObjectNumber(
            this.getJsObjectBlock(argonConfigBlock, 'lazyload'),
            'threshold',
            0,
          ),
        },
        pangu: this.getJsObjectString(argonConfigBlock, 'pangu', ''),
        pjaxAnimationDuration: this.getJsObjectNumber(
          argonConfigBlock,
          'pjax_animation_durtion',
          0,
        ),
        waterflowColumns:
          this.getJsObjectRawValue(argonConfigBlock, 'waterflow_columns') || '',
        wpPath: this.getJsObjectString(argonConfigBlock, 'wp_path', ''),
        zoomify: this.getJsObjectBoolean(argonConfigBlock, 'zoomify', false),
      },
      backgroundDarkBrightness: this.getArgonBackgroundDarkBrightness(html),
      backgroundDarkImage: this.getArgonBackgroundImage(html, '#content:after'),
      backgroundDarkOpacity: this.getArgonBackgroundDarkOpacity(html),
      backgroundImage: this.getArgonBackgroundImage(html),
      backgroundOpacity: this.getArgonBackgroundOpacity(html),
      bodyClass: this.getTagClassList(html, 'body'),
      darkmodeAutoSwitch: this.getInlineJsString(
        html,
        'darkmodeAutoSwitch',
      ),
      enableCustomThemeColor:
        this.getMetaContent(html, 'argon-enable-custom-theme-color') === 'true',
      headerMenu: this.getArgonMenuItems(html, 'navbar_global'),
      htmlClass: this.getTagClassList(html, 'html').filter(
        (item) => item !== 'no-js',
      ),
      site: {
        authorAvatar: this.getArgonAuthorAvatar(html),
        authorName: this.getArgonAuthorName(html),
        description: root?.description || '',
        home: root?.home || '',
        title: root?.name || this.getMetaContent(html, 'og:title') || '',
        url: root?.url || '',
      },
      sidebarMenu: this.getArgonMenuItems(html, 'leftbar_part1_menu'),
      themeCardRadius: this.toNonNegativeNumber(
        this.getMetaContent(html, 'theme-card-radius'),
        4,
      ),
      themeColor: this.getMetaContent(html, 'theme-color'),
      themeColorRgb: this.getMetaContent(html, 'theme-color-rgb'),
      themeVersion: this.getMetaContent(html, 'theme-version'),
    };
  }

  private getArgonBackgroundImage(html: string, selector = '#content:before') {
    const block = this.getCssBlock(html, selector);
    const rawValue =
      /background(?:-image)?\s*:\s*url\(([^)]+)\)/i.exec(block)?.[1] || '';
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');

    return this.decodeUriText(this.decodeHtmlEntities(value));
  }

  private getArgonBackgroundOpacity(html: string) {
    const value = this.getCssDeclaration(
      this.getCssBlock(html, '#content:before'),
      'opacity',
    );

    return this.toNonNegativeNumber(value, 1);
  }

  private getArgonBackgroundDarkOpacity(html: string) {
    const darkValue = this.getCssDeclaration(
      this.getCssBlock(html, 'html.darkmode #content:after'),
      'opacity',
    );
    const baseValue = this.getCssDeclaration(
      this.getCssBlock(html, '#content:after'),
      'opacity',
    );

    return this.toNonNegativeNumber(darkValue || baseValue, 1);
  }

  private getArgonBackgroundDarkBrightness(html: string) {
    const filter = this.getCssDeclaration(
      this.getCssBlock(html, 'html.darkmode #content:before'),
      'filter',
    );
    const value = /brightness\(([^)]+)\)/i.exec(filter)?.[1] || '';

    return this.toNonNegativeNumber(value, 1);
  }

  private getArgonAuthorAvatar(html: string) {
    const style = this.getTagAttributeById(
      html,
      'leftbar_overview_author_image',
      'style',
    );
    const value =
      /background(?:-image)?\s*:\s*url\(([^)]+)\)/i.exec(style)?.[1] || '';

    return this.decodeUriText(
      this.decodeHtmlEntities(value.trim().replace(/^['"]|['"]$/g, '')),
    );
  }

  private getArgonAuthorName(html: string) {
    const pattern =
      /<[^>]*id=["']leftbar_overview_author_name["'][^>]*>([\s\S]*?)<\/[^>]+>/i;

    return this.stripHtml(pattern.exec(html)?.[1] || '');
  }

  private getArgonMenuItems(
    html: string,
    elementId: string,
  ): WordpressArgonMenuItem[] {
    const menuHtml = this.getElementHtmlById(html, elementId);

    return Array.from(menuHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi))
      .map((match) => {
        const attrText = match[1] || '';
        const href = this.getHtmlAttribute(attrText, 'href');
        const label = this.stripHtml(match[2] || '');
        const icon = /<i\b[^>]*class=["']([^"']*)["']/i.exec(match[2] || '')?.[1] || '';

        if (!href || !label) return null;

        const menuItem: WordpressArgonMenuItem = {
          href: this.decodeHtmlEntities(href),
          label,
        };
        const iconName = icon
          .split(/\s+/)
          .find((item) => item.startsWith('fa-'));

        if (/^https?:\/\//i.test(href)) {
          menuItem.external = true;
        }
        if (iconName) {
          menuItem.icon = iconName;
        }

        return menuItem;
      })
      .filter((item): item is WordpressArgonMenuItem => !!item);
  }

  private getCssBlock(html: string, selector: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(selector)}\\s*\\{(?<body>[^}]*)\\}`,
      'i',
    );

    return pattern.exec(html)?.groups?.body || '';
  }

  private getCssDeclaration(block: string, property: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(property)}\\s*:\\s*([^;]+)`,
      'i',
    );

    return pattern.exec(block)?.[1]?.trim() || '';
  }

  private getTagAttributeById(html: string, id: string, attribute: string) {
    const tagPattern = new RegExp(
      `<[^>]*id=["']${this.escapeRegex(id)}["'][^>]*>`,
      'i',
    );
    const tag = tagPattern.exec(html)?.[0] || '';
    const attrPattern = new RegExp(
      `${this.escapeRegex(attribute)}=["']([^"']*)["']`,
      'i',
    );

    return attrPattern.exec(tag)?.[1] || '';
  }

  private getElementHtmlById(html: string, id: string) {
    const startPattern = new RegExp(
      `<(?<tag>[a-z0-9-]+)[^>]*id=["']${this.escapeRegex(id)}["'][^>]*>`,
      'i',
    );
    const startMatch = startPattern.exec(html);
    if (!startMatch?.groups?.tag) return '';

    const tag = startMatch.groups.tag;
    const startIndex = startMatch.index + startMatch[0].length;
    const endPattern = new RegExp(`</${this.escapeRegex(tag)}>`, 'i');
    const endMatch = endPattern.exec(html.slice(startIndex));

    return endMatch
      ? html.slice(startIndex, startIndex + endMatch.index)
      : html.slice(startIndex);
  }

  private getHtmlAttribute(attrText: string, attribute: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(attribute)}=["']([^"']*)["']`,
      'i',
    );

    return pattern.exec(attrText)?.[1] || '';
  }

  private getMetaContent(html: string, name: string) {
    const escapedName = this.escapeRegex(name);
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]+content=["']([^"']*)["']`,
      'i',
    );

    return this.decodeHtmlEntities(pattern.exec(html)?.[1] || '');
  }

  private getTagClassList(html: string, tagName: 'body' | 'html') {
    const pattern = new RegExp(`<${tagName}[^>]*class=["']([^"']*)["']`, 'i');
    const classValue = pattern.exec(html)?.[1] || '';

    return classValue
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private getScriptObjectBlock(html: string, name: string) {
    const pattern = new RegExp(`${this.escapeRegex(name)}\\s*=\\s*\\{`, 'i');
    const match = pattern.exec(html);
    if (!match) return '';

    return this.readBraceBlock(html, match.index + match[0].lastIndexOf('{'));
  }

  private getJsObjectBlock(block: string, key: string) {
    const pattern = new RegExp(`${this.escapeRegex(key)}\\s*:\\s*\\{`, 'i');
    const match = pattern.exec(block);
    if (!match) return '';

    return this.readBraceBlock(block, match.index + match[0].lastIndexOf('{'));
  }

  private readBraceBlock(value: string, startIndex: number) {
    let depth = 0;
    for (let index = startIndex; index < value.length; index += 1) {
      const char = value[index];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex + 1, index);
      }
    }

    return '';
  }

  private getInlineJsString(html: string, key: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(key)}\\s*=\\s*["']([^"']*)["']`,
      'i',
    );

    return pattern.exec(html)?.[1] || '';
  }

  private getJsObjectString(block: string, key: string, fallback: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(key)}\\s*:\\s*["']([^"']*)["']`,
      'i',
    );

    return pattern.exec(block)?.[1] || fallback;
  }

  private getJsObjectNumber(block: string, key: string, fallback: number) {
    const pattern = new RegExp(
      `${this.escapeRegex(key)}\\s*:\\s*([0-9]+)`,
      'i',
    );
    const value = Number(pattern.exec(block)?.[1]);

    return Number.isFinite(value) ? value : fallback;
  }

  private getJsObjectBoolean(block: string, key: string, fallback: boolean) {
    const rawValue = this.getJsObjectRawValue(block, key);
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;

    return fallback;
  }

  private toNonNegativeNumber(value: unknown, fallback: number) {
    const nextValue = Number(value);

    return Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : fallback;
  }

  private getJsObjectRawValue(block: string, key: string) {
    const pattern = new RegExp(
      `${this.escapeRegex(key)}\\s*:\\s*(["'][^"']*["']|true|false|[0-9]+)`,
      'i',
    );
    const value = pattern.exec(block)?.[1] || '';

    return value.replace(/^["']|["']$/g, '');
  }

  private decodeHtmlEntities(value: string) {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private decodeUriText(value: string) {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getWordpressResponseErrorMessage(data: any, status: number) {
    if (data?.message) return data.message;
    if (typeof data === 'string' && data) return data;
    return `WordPress 请求失败：${status}`;
  }

  private throwWordpressNetworkError(err: unknown): never {
    const message = this.toolsService.getErrorMessage(err, '未知错误');
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
      message: this.toolsService.getErrorMessage(err, 'WordPress 暂不可用'),
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

  private getForwardableAuthorization(request: Request) {
    const authorization = this.toolsService.readHeader(
      request,
      'authorization',
    );

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
