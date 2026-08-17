import { createHash, randomBytes } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ClientIpService } from './client-ip.service';
import { RedisRateLimitStore } from './redis-rate-limit.store';

export type PublicRateLimitPolicy =
  | 'baseline'
  | 'exception'
  | 'health'
  | 'login'
  | 'management'
  | 'public-read';

export interface PublicRateLimitContext {
  explicitlyPublic?: boolean;
}

export interface PublicRateLimitOutcome {
  allowed: boolean;
  policy: PublicRateLimitPolicy;
  redisAvailable: boolean;
  retryAfterSeconds?: number;
  statusCode?: number;
}

export type VerifiedTokenOperation = 'logout' | 'refresh';

const LOGIN_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/refresh']);
const MANAGEMENT_EXACT_PATHS = new Set([
  '/',
  '/api',
  '/api-json',
  '/api-yaml',
  '/doc.html',
  '/services.json',
]);
const UPLOAD_PATHS = new Set([
  '/minio/upload',
  '/qqbot/plugin-platform/upload',
]);
const SSE_PATHS = new Set([
  '/qqbot/account/scan/events',
  '/system/environment/events/stream',
  '/system/network/events/stream',
]);
const CONFIG_KEYS = {
  baselineLimit: 'PUBLIC_RATE_LIMIT_BASELINE_LIMIT',
  loginGlobalLimit: 'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT',
  loginGlobalWindowMs: 'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS',
  loginIpLimit: 'PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT',
  loginIpWindowMs: 'PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS',
  loginUsernameLimit: 'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT',
  loginUsernameWindowMs: 'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS',
  live2dConcurrentLeaseMs: 'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS',
  live2dConcurrentLimit: 'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT',
  logoutSubjectLimit: 'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT',
  logoutSubjectWindowMs: 'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS',
  publicReadLimit: 'PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT',
  refreshSubjectLimit: 'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT',
  refreshSubjectWindowMs: 'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS',
  redisKeyPrefix: 'PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX',
  swaggerAllowlist: 'PUBLIC_SECURITY_SWAGGER_ALLOWLIST',
  warningIntervalMs: 'PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS',
  windowMs: 'PUBLIC_RATE_LIMIT_WINDOW_MS',
} as const;
const SAFE_REDIS_PREFIX = /^[A-Za-z0-9:_-]+$/;

@Injectable()
export class PublicRateLimitService {
  private readonly logger = new Logger(PublicRateLimitService.name);
  private readonly production: boolean;
  private readonly windowMs: number;
  private readonly warningIntervalMs: number;
  private readonly consumedRequests = new WeakMap<
    Request,
    Promise<PublicRateLimitOutcome>
  >();
  private readonly limits: Record<
    Exclude<PublicRateLimitPolicy, 'exception'>,
    number
  >;
  private readonly loginLimits: {
    global: number;
    ip: number;
    username: number;
  };
  private readonly loginWindows: {
    global: number;
    ip: number;
    username: number;
  };
  private readonly live2dConcurrentLeaseMs: number;
  private readonly live2dConcurrentLimit: number;
  private readonly subjectLimits: Record<VerifiedTokenOperation, number>;
  private readonly subjectWindows: Record<VerifiedTokenOperation, number>;
  private readonly swaggerAllowlist: ReadonlySet<string>;
  private readonly websocketPath: string;
  private lastRedisWarningAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly configService: ConfigService,
    private readonly clientIpService: ClientIpService,
    private readonly store: RedisRateLimitStore,
  ) {
    this.production = this.configService.get('NODE_ENV') === 'production';
    this.windowMs = this.readPositiveInteger(CONFIG_KEYS.windowMs, 60000, {
      max: 3600000,
      min: 1000,
    });
    this.warningIntervalMs = this.readPositiveInteger(
      CONFIG_KEYS.warningIntervalMs,
      30000,
      {
        max: 3600000,
        min: 1000,
      },
    );
    const baselineLimit = this.readPositiveInteger(
      CONFIG_KEYS.baselineLimit,
      300,
    );
    const publicReadLimit = this.readPositiveInteger(
      CONFIG_KEYS.publicReadLimit,
      60,
    );
    this.loginLimits = {
      global: this.readPositiveInteger(CONFIG_KEYS.loginGlobalLimit, 100),
      ip: this.readPositiveInteger(CONFIG_KEYS.loginIpLimit, 5),
      username: this.readPositiveInteger(CONFIG_KEYS.loginUsernameLimit, 10),
    };
    this.loginWindows = {
      global: this.readPositiveInteger(CONFIG_KEYS.loginGlobalWindowMs, 60000, {
        max: 3600000,
        min: 1000,
      }),
      ip: this.readPositiveInteger(CONFIG_KEYS.loginIpWindowMs, 60000, {
        max: 3600000,
        min: 1000,
      }),
      username: this.readPositiveInteger(
        CONFIG_KEYS.loginUsernameWindowMs,
        900000,
        {
          max: 3600000,
          min: 1000,
        },
      ),
    };
    this.live2dConcurrentLimit = this.readPositiveInteger(
      CONFIG_KEYS.live2dConcurrentLimit,
      8,
    );
    this.live2dConcurrentLeaseMs = this.readPositiveInteger(
      CONFIG_KEYS.live2dConcurrentLeaseMs,
      120000,
      {
        max: 3600000,
        min: 1000,
      },
    );
    this.subjectLimits = {
      logout: this.readPositiveInteger(CONFIG_KEYS.logoutSubjectLimit, 10),
      refresh: this.readPositiveInteger(CONFIG_KEYS.refreshSubjectLimit, 30),
    };
    this.subjectWindows = {
      logout: this.readPositiveInteger(
        CONFIG_KEYS.logoutSubjectWindowMs,
        60000,
        {
          max: 3600000,
          min: 1000,
        },
      ),
      refresh: this.readPositiveInteger(
        CONFIG_KEYS.refreshSubjectWindowMs,
        60000,
        {
          max: 3600000,
          min: 1000,
        },
      ),
    };
    this.limits = {
      baseline: baselineLimit,
      health: publicReadLimit,
      login: this.loginLimits.ip,
      management: baselineLimit,
      'public-read': publicReadLimit,
    };
    this.assertRedisPrefix();
    this.swaggerAllowlist = new Set(this.readSwaggerAllowlist());
    this.websocketPath = this.readWebsocketPath();
  }

  /**
   * 根据`request`、`context`处理分类公开的速率限制记录；从 `getPath` 读取分类公开的速率限制记录。
   * @param request - 用于分类公开的速率限制记录的当前 HTTP 请求，包含 `method` 字段。
   * @param context - 用于分类公开的速率限制记录的领域对象，包含 `explicitlyPublic` 字段；省略时默认采用 `{}`。
   * @returns 表示分类公开的速率限制记录的固定文本 `'baseline'`。
   */
  classify(
    request: Request,
    context: PublicRateLimitContext = {},
  ): PublicRateLimitPolicy {
    const path = this.getPath(request);
    if (this.isShortResponseException(request, path)) return 'exception';
    if (LOGIN_PATHS.has(path)) return 'login';
    if (this.isManagementPath(path)) return 'management';
    if (path === '/health' || path.startsWith('/health/')) return 'health';
    if (this.isLockedPublicRead(request.method, path)) return 'public-read';
    if (context.explicitlyPublic) return 'public-read';
    return 'baseline';
  }

  /**
   * 根据`request`、`context`处理消费公开的速率限制记录；从 `consumedRequests.get` 读取消费公开的速率限制记录。
   * @param request - 用于消费公开的速率限制记录的当前 HTTP 请求。
   * @param context - 决定消费公开的速率限制记录内容、边界或目标的 `context` 值；省略时默认采用 `{}`。
   * @returns 消费公开的速率限制记录。
   */
  consume(
    request: Request,
    context: PublicRateLimitContext = {},
  ): Promise<PublicRateLimitOutcome> {
    const consumed = this.consumedRequests.get(request);
    if (consumed) return consumed;

    const outcome = this.consumeOnce(request, context);
    this.consumedRequests.set(request, outcome);
    return outcome;
  }

  /**
   * 清空成功的登录用户名。
   * @param username - 决定是否启用“username”分支的布尔选项。
   * @throws 当 `store.deleteCounter` 或 `hashIdentity` 调用失败时拒绝当前输入并抛出 `ServiceUnavailableException`。
   */
  async clearSuccessfulLoginUsername(username: string): Promise<void> {
    try {
      await this.store.deleteCounter(
        'login:username',
        this.hashIdentity(this.normalizeUsername(username)),
      );
    } catch {
      this.warnRedisUnavailable('login');
      throw new ServiceUnavailableException('登录限流服务暂不可用');
    }
  }

  /**
   * 根据`operation`、`subject`、`response`处理消费已验证的令牌主体；从 `error.getStatus` 读取消费已验证的令牌主体。
   * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
   * @param subject - 决定消费已验证的令牌主体内容、边界或目标的 `subject` 值。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @throws 主体限流额度耗尽时抛出 429；限流存储失败时抛出 `ServiceUnavailableException`，已有 429 会原样透传。
   */
  async consumeVerifiedTokenSubject(
    operation: VerifiedTokenOperation,
    subject: string,
    response?: Pick<Response, 'setHeader'>,
  ): Promise<void> {
    try {
      const counter = await this.store.increment(
        `auth:${operation}:subject`,
        this.hashIdentity(subject),
        this.subjectWindows[operation],
      );
      if (counter.count <= this.subjectLimits[operation]) return;

      response?.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(counter.ttlMs / 1000))),
      );
      throw new HttpException(
        '请求过于频繁，请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      this.warnRedisUnavailable('login');
      throw new ServiceUnavailableException('登录限流服务暂不可用');
    }
  }

  /**
   * 根据`request`、`response`处理Live2D并发的租约；当 `terminal || response.destroyed || response.writableEnded` 成立时直接结束且不产生返回值。
   * @param request - 用于Live2D并发的租约的当前 HTTP 请求。
   * @param response - 包含 `destroyed`、`writableEnded`、`off`、`once` 字段的上游服务响应。
   * @throws 当 `!lease.acquired` 成立时拒绝当前输入并抛出 `HttpException`；当 `error instanceof HttpException && error.getStatus() === HttpStatus.TOO_…` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  async bindLive2DConcurrentLease(
    request: Request,
    response: Response,
  ): Promise<void> {
    const identity = this.hashIdentity(
      this.clientIpService.getClientIp(request),
    );
    const leaseToken = randomBytes(16).toString('hex');
    let leaseAcquired = false;
    let terminal = response.destroyed || response.writableEnded;
    let releasePromise: Promise<void> | undefined;
    let renewalTimer: ReturnType<typeof setInterval> | undefined;

    const detachTerminalListeners = () => {
      response.off('finish', handleTerminal);
      response.off('close', handleTerminal);
      response.off('error', handleTerminal);
    };
    const clearRenewalTimer = () => {
      if (!renewalTimer) return;
      clearInterval(renewalTimer);
      renewalTimer = undefined;
    };
    const releaseLeaseOnce = (): Promise<void> => {
      if (releasePromise) return releasePromise;
      clearRenewalTimer();
      detachTerminalListeners();
      releasePromise = this.store
        .releaseLease('live2d:concurrent', identity, leaseToken)
        .then(() => undefined)
        .catch(() => this.warnRedisUnavailable('public-read'));
      return releasePromise;
    };
    const handleTerminal = () => {
      terminal = true;
      clearRenewalTimer();
      detachTerminalListeners();
      if (leaseAcquired) void releaseLeaseOnce();
    };

    if (terminal) return;
    response.once('finish', handleTerminal);
    response.once('close', handleTerminal);
    response.once('error', handleTerminal);

    try {
      const lease = await this.store.acquireLease(
        'live2d:concurrent',
        identity,
        leaseToken,
        this.live2dConcurrentLimit,
        this.live2dConcurrentLeaseMs,
      );
      if (!lease.acquired) {
        throw new HttpException(
          '请求过于频繁，请稍后重试',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      leaseAcquired = true;
    } catch (error) {
      detachTerminalListeners();
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      this.warnRedisUnavailable('public-read');
      return;
    }

    if (terminal || response.destroyed || response.writableEnded) {
      terminal = true;
      await releaseLeaseOnce();
      return;
    }

    renewalTimer = setInterval(
      () => {
        void this.store
          .renewLease(
            'live2d:concurrent',
            identity,
            leaseToken,
            this.live2dConcurrentLeaseMs,
          )
          .then((renewed) => {
            if (!renewed) this.warnRedisUnavailable('public-read');
          })
          .catch(() => this.warnRedisUnavailable('public-read'));
      },
      Math.max(1000, Math.floor(this.live2dConcurrentLeaseMs / 2)),
    );
    renewalTimer.unref();
  }

  /**
   * 根据`request`、`context`处理消费一次；当 `policy === 'exception'` 成立时返回 `{ allowed: true, policy, redisAvailable: tr…`。
   * @param request - 用于消费一次的当前 HTTP 请求，包含 `method` 字段。
   * @param context - 决定消费一次内容、边界或目标的 `context` 值。
   * @returns 包含 `allowed`、`policy`、`redisAvailable` 字段的消费一次。
   */
  private async consumeOnce(
    request: Request,
    context: PublicRateLimitContext,
  ): Promise<PublicRateLimitOutcome> {
    const policy = this.classify(request, context);
    if (policy === 'exception') {
      return {
        allowed: true,
        policy,
        redisAvailable: true,
      };
    }

    const clientIp = this.clientIpService.getClientIp(request);
    if (
      policy === 'management' &&
      this.production &&
      !this.swaggerAllowlist.has(clientIp)
    ) {
      return {
        allowed: false,
        policy,
        redisAvailable: true,
        statusCode: 403,
      };
    }

    if (policy === 'login') {
      return this.consumeLogin(request, clientIp);
    }

    const namespace = `${policy}:${this.getMethodBucket(request.method)}`;
    const identity = this.hashIdentity(clientIp);
    try {
      const counter = await this.store.increment(
        namespace,
        identity,
        this.windowMs,
      );
      if (counter.count <= this.limits[policy]) {
        return {
          allowed: true,
          policy,
          redisAvailable: true,
        };
      }

      return {
        allowed: false,
        policy,
        redisAvailable: true,
        retryAfterSeconds: Math.max(1, Math.ceil(counter.ttlMs / 1000)),
        statusCode: 429,
      };
    } catch {
      this.warnRedisUnavailable(policy);
      return {
        allowed: true,
        policy,
        redisAvailable: false,
      };
    }
  }

  /**
   * 根据`request`与当前约束判定管理表层；从 `getPath` 读取管理表层。
   * @param request - 用于管理表层的当前 HTTP 请求。
   * @returns 满足管理表层约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isManagementSurface(request: Request): boolean {
    return this.isManagementPath(this.getPath(request));
  }

  /**
   * 根据`request`、`clientIp`处理消费登录；当 `!exceeded.length` 成立时返回 `{ allowed: true, policy: 'login', redisAvai…`。
   * @param request - 用于消费登录的当前 HTTP 请求，包含 `method`、`body` 字段。
   * @param clientIp - 决定消费登录内容、边界或目标的 `clientIp` 值。
   * @returns 包含 `allowed`、`policy`、`redisAvailable`、`statusCode` 字段的消费登录。
   */
  private async consumeLogin(
    request: Request,
    clientIp: string,
  ): Promise<PublicRateLimitOutcome> {
    const buckets = [
      {
        identity: this.hashIdentity(clientIp),
        limit: this.loginLimits.ip,
        namespace: 'login:ip',
        ttlMs: this.loginWindows.ip,
      },
    ];
    if (
      request.method.toUpperCase() === 'POST' &&
      this.getPath(request) === '/auth/login'
    ) {
      buckets.push({
        identity: this.hashIdentity(
          this.normalizeUsername(request.body?.username),
        ),
        limit: this.loginLimits.username,
        namespace: 'login:username',
        ttlMs: this.loginWindows.username,
      });
    }
    buckets.push({
      identity: 'all',
      limit: this.loginLimits.global,
      namespace: 'login:global',
      ttlMs: this.loginWindows.global,
    });

    try {
      const counters = await this.store.incrementMany(buckets);
      const exceeded = counters
        .map((counter, index) => ({
          ...counter,
          limit: buckets[index].limit,
        }))
        .filter((counter) => counter.count > counter.limit);
      if (!exceeded.length) {
        return {
          allowed: true,
          policy: 'login',
          redisAvailable: true,
        };
      }

      return {
        allowed: false,
        policy: 'login',
        redisAvailable: true,
        retryAfterSeconds: Math.max(
          ...exceeded.map((counter) => Math.ceil(counter.ttlMs / 1000)),
          1,
        ),
        statusCode: 429,
      };
    } catch {
      this.warnRedisUnavailable('login');
      return {
        allowed: false,
        policy: 'login',
        redisAvailable: false,
        statusCode: 503,
      };
    }
  }

  /**
   * 根据`method`、`path`与当前约束判定已锁定公开的读取。
   * @param method - 决定已锁定公开的读取内容、边界或目标的 `method` 值。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 满足已锁定公开的读取约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isLockedPublicRead(method: string, path: string): boolean {
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) return false;

    return (
      path === '/blog/theme/config' ||
      path.startsWith('/blog/article/public/') ||
      path.startsWith('/blog/live2d/') ||
      path.startsWith('/blog/asset/')
    );
  }

  /**
   * 根据`path`与当前约束判定管理路径。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 满足管理路径约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isManagementPath(path: string): boolean {
    return (
      MANAGEMENT_EXACT_PATHS.has(path) ||
      path.startsWith('/api/') ||
      path.startsWith('/assets/')
    );
  }

  /**
   * 根据`request`、`path`与当前约束判定短的响应异常；当 `path === this.websocketPath && upgrade === 'websocket' && con…` 成立时返回 `true`。
   * @param request - 用于短的响应异常的当前 HTTP 请求。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 满足短的响应异常约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isShortResponseException(request: Request, path: string): boolean {
    if (UPLOAD_PATHS.has(path)) return true;

    const upgrade = this.readHeader(request, 'upgrade')?.toLowerCase();
    const connection = this.readHeader(request, 'connection')?.toLowerCase();
    if (
      path === this.websocketPath &&
      upgrade === 'websocket' &&
      connection?.includes('upgrade')
    ) {
      return true;
    }

    const acceptsEventStream = this.readHeader(request, 'accept')
      ?.toLowerCase()
      .split(',')
      .some((value) => value.trim().startsWith('text/event-stream'));
    return !!acceptsEventStream && SSE_PATHS.has(path);
  }

  /**
   * 按`request`读取路径；当 `path.length > 1 && path.endsWith('/')` 成立时返回 `path.slice(0, -1)`。
   * @param request - 用于路径的当前 HTTP 请求，包含 `path`、`originalUrl`、`url` 字段。
   * @returns 路径。
   */
  private getPath(request: Request): string {
    const raw = request.path || request.originalUrl || request.url || '/';
    const path = raw.split('?')[0] || '/';
    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }
    return path;
  }

  /**
   * 按`method`读取方法存储桶；当 `normalized === 'GET' || normalized === 'HEAD'` 成立时返回 `'read'`。
   * @param method - 决定方法存储桶内容、边界或目标的 `method` 值。
   * @returns 当前状态对应的方法存储桶，取值为 `'read'`。
   */
  private getMethodBucket(method: string): string {
    const normalized = method.toUpperCase();
    if (normalized === 'GET' || normalized === 'HEAD') {
      return 'read';
    }
    return normalized.toLowerCase();
  }

  /**
   * 将`value`规范为用户名，使等价输入得到一致表示。
   * @param value - 待转换为用户名的原始值。
   * @returns 规范化后的用户名；主值为空时采用 `'<missing>'` 兜底。
   */
  private normalizeUsername(value: unknown): string {
    if (typeof value !== 'string') return '<missing>';
    return value.normalize('NFKC').trim().toLowerCase() || '<missing>';
  }

  /**
   * 根据`value`与当前约束判定身份摘要。
   * @param value - 待判定是否满足身份摘要约束的候选值。
   * @returns 满足身份摘要约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private hashIdentity(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * 按当前运行态读取Swagger白名单；从 `configService.get` 读取Swagger白名单。
   * @returns 按输入顺序得到的Swagger白名单列表；没有匹配项时为空数组。
   * @throws 当 `normalized.some((value) => !value)` 成立时拒绝当前输入并抛出 `Error`；当 `this.production && normalized.length === 0` 成立时拒绝当前输入并抛出 `Error`。
   */
  private readSwaggerAllowlist(): string[] {
    const values =
      `${this.configService.get(CONFIG_KEYS.swaggerAllowlist) || ''}`
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const normalized = values.map((value) =>
      this.clientIpService.normalizeIp(value),
    );
    if (normalized.some((value) => !value)) {
      throw new Error(
        `${CONFIG_KEYS.swaggerAllowlist} 只能包含逗号分隔的精确 IP 地址`,
      );
    }
    if (this.production && normalized.length === 0) {
      throw new Error(`${CONFIG_KEYS.swaggerAllowlist} 在生产环境不能为空`);
    }

    return normalized as string[];
  }

  /**
   * 按当前运行态读取WebSocket路径；从 `configService.get` 读取WebSocket路径。
   * @returns WebSocket路径。
   * @throws 当 `!path.startsWith('/') || /[?#\s]/.test(path)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private readWebsocketPath(): string {
    const value = `${this.configService.get('QQBOT_REVERSE_WS_PATH') || ''}`
      .trim()
      .replace(/\/+$/, '');
    const path = value || '/qqbot/onebot/reverse';
    if (!path.startsWith('/') || /[?#\s]/.test(path)) {
      throw new Error('QQBOT_REVERSE_WS_PATH 必须是根相对路径');
    }
    return path;
  }

  /**
   * 校验当前运行态是否满足Redis前缀约束，并拒绝不合法输入；从 `configService.get` 读取Redis前缀。
   * @throws 当 `!value || !SAFE_REDIS_PREFIX.test(value)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private assertRedisPrefix() {
    const value = `${this.configService.get(CONFIG_KEYS.redisKeyPrefix) || ''}`;
    if (!value || !SAFE_REDIS_PREFIX.test(value)) {
      throw new Error(
        `${CONFIG_KEYS.redisKeyPrefix} 只能包含字母、数字、冒号、横线或下划线`,
      );
    }
  }

  /**
   * 按`key`、`fallback`、`bounds`读取正数整数；当 `raw === undefined || raw === null || `${raw}`.trim() === ''` 成立时返回 `fallback`。
   * @param key - 用于读取或更新正数整数的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param bounds - 用于正数整数的领域对象，包含 `min`、`max` 字段；省略时默认采用 `{}`。
   * @returns 正数整数。
   * @throws 当 `this.production` 成立时拒绝当前输入并抛出 `Error`；当 `!Number.isInteger(value) || value < min || value > max` 成立时拒绝当前输入并抛出 `Error`。
   */
  private readPositiveInteger(
    key: string,
    fallback: number,
    bounds: {
      max?: number;
      min?: number;
    } = {},
  ): number {
    const raw = this.configService.get<string | number>(key);
    if (raw === undefined || raw === null || `${raw}`.trim() === '') {
      if (this.production) throw new Error(`${key} 在生产环境不能为空`);
      return fallback;
    }

    const value = Number(raw);
    const min = bounds.min ?? 1;
    const max = bounds.max ?? 1000000;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${key} 必须是 ${min} 到 ${max} 之间的整数`);
    }
    return value;
  }

  /**
   * 安全记录告警Redis不可用，并会更新 `this.lastRedisWarningAt`。
   * @param policy - 决定warnRedisUnavailable内容、边界或目标的 `policy` 值。
   */
  private warnRedisUnavailable(policy: PublicRateLimitPolicy) {
    const now = Date.now();
    if (now - this.lastRedisWarningAt < this.warningIntervalMs) return;

    this.lastRedisWarningAt = now;
    this.logger.warn(
      { policy },
      '公网接口限流 Redis 暂不可用，已按固定故障策略处理',
    );
  }

  /**
   * 按请求头名读取首个字符串值；数组仅取第一项，缺失或非字符串输入保留空值。
   * @param request - 用于按请求头名读取首个字符串值的当前 HTTP 请求，包含 `headers` 字段。
   * @param name - 决定按请求头名读取首个字符串值内容、边界或目标的 `name` 值。
   * @returns 按请求头名读取首个字符串值。
   */
  private readHeader(request: Request, name: string): string | undefined {
    const value = request.headers?.[name];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
