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

  isManagementSurface(request: Request): boolean {
    return this.isManagementPath(this.getPath(request));
  }

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

  private isLockedPublicRead(method: string, path: string): boolean {
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) return false;

    return (
      path === '/blog/theme/config' ||
      path.startsWith('/blog/article/public/') ||
      path.startsWith('/blog/live2d/') ||
      path.startsWith('/blog/asset/')
    );
  }

  private isManagementPath(path: string): boolean {
    return (
      MANAGEMENT_EXACT_PATHS.has(path) ||
      path.startsWith('/api/') ||
      path.startsWith('/assets/')
    );
  }

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

  private getPath(request: Request): string {
    const raw = request.path || request.originalUrl || request.url || '/';
    const path = raw.split('?')[0] || '/';
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  }

  private getMethodBucket(method: string): string {
    const normalized = method.toUpperCase();
    return normalized === 'GET' || normalized === 'HEAD'
      ? 'read'
      : normalized.toLowerCase();
  }

  private normalizeUsername(value: unknown): string {
    if (typeof value !== 'string') return '<missing>';
    return value.normalize('NFKC').trim().toLowerCase() || '<missing>';
  }

  private hashIdentity(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

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

  private assertRedisPrefix() {
    const value = `${this.configService.get(CONFIG_KEYS.redisKeyPrefix) || ''}`;
    if (!value || !SAFE_REDIS_PREFIX.test(value)) {
      throw new Error(
        `${CONFIG_KEYS.redisKeyPrefix} 只能包含字母、数字、冒号、横线或下划线`,
      );
    }
  }

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

  private warnRedisUnavailable(policy: PublicRateLimitPolicy) {
    const now = Date.now();
    if (now - this.lastRedisWarningAt < this.warningIntervalMs) return;

    this.lastRedisWarningAt = now;
    this.logger.warn(
      { policy },
      '公网接口限流 Redis 暂不可用，已按固定故障策略处理',
    );
  }

  private readHeader(request: Request, name: string): string | undefined {
    const value = request.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
