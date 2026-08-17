import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveNapcatWebuiPublicBaseUrl } from './napcat-webui-public-prefix';

const DEFAULT_GATEWAY_PORT = 48086;
const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_SESSION_TTL_MS = 60_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5000;
const MAX_TICKET_TTL_MS = 60_000;

@Injectable()
export class NapcatWebuiGatewayConfigService {
  constructor(private readonly configService: ConfigService) {}

  /** 返回当前。 */
  now() {
    return Date.now();
  }

  /** 返回有效期毫秒。 */
  ttlMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_SESSION_TTL_MS',
      DEFAULT_SESSION_TTL_MS,
    );
  }

  /** 返回票据有效期毫秒。 */
  ticketTtlMs() {
    return Math.min(
      this.getPositiveNumber(
        'NAPCAT_WEBUI_GATEWAY_TICKET_TTL_MS',
        MAX_TICKET_TTL_MS,
      ),
      MAX_TICKET_TTL_MS,
    );
  }

  /** 返回端口。 */
  port() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_PORT',
      DEFAULT_GATEWAY_PORT,
    );
  }

  /** 返回上游超时毫秒。 */
  upstreamTimeoutMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_UPSTREAM_TIMEOUT_MS',
      DEFAULT_UPSTREAM_TIMEOUT_MS,
    );
  }

  /** 返回内部密钥。 */
  internalSecret() {
    return this.getString('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET');
  }

  /** 返回RedisURL。 */
  redisUrl() {
    const explicitUrl = this.getString('NAPCAT_WEBUI_GATEWAY_REDIS_URL');
    if (explicitUrl) return explicitUrl;

    const host =
      this.getString('NAPCAT_WEBUI_GATEWAY_REDIS_HOST') || DEFAULT_REDIS_HOST;
    const port = this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_REDIS_PORT',
      DEFAULT_REDIS_PORT,
    );

    return `redis://${host}:${port}`;
  }

  /** 返回公开的会话前缀。 */
  publicSessionPrefix() {
    return `${resolveNapcatWebuiPublicBaseUrl(
      this.getString('NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'),
    )}/session`;
  }

  /** 读取字符串。 */
  private getString(key: string) {
    return String(this.configService.get<string>(key) || '').trim();
  }

  /** 读取正数数字。 */
  private getPositiveNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
