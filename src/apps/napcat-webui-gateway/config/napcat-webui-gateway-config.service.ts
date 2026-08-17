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

  /**
   * 根据当前运行态处理当前 Unix 毫秒时间戳。
   * @returns 当前 Unix 毫秒时间戳。
   */
  now() {
    return Date.now();
  }

  /**
   * 按边界约束计算有效期毫秒。
   * @returns 按边界约束计算有效期毫秒。
   */
  ttlMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_SESSION_TTL_MS',
      DEFAULT_SESSION_TTL_MS,
    );
  }

  /**
   * 按边界约束计算票据有效期毫秒。
   * @returns 按边界约束计算票据有效期毫秒。
   */
  ticketTtlMs() {
    return Math.min(
      this.getPositiveNumber(
        'NAPCAT_WEBUI_GATEWAY_TICKET_TTL_MS',
        MAX_TICKET_TTL_MS,
      ),
      MAX_TICKET_TTL_MS,
    );
  }

  /**
   * 按边界约束计算端口。
   * @returns 按边界约束计算端口。
   */
  port() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_PORT',
      DEFAULT_GATEWAY_PORT,
    );
  }

  /**
   * 按边界约束计算上游超时毫秒。
   * @returns 按边界约束计算上游超时毫秒。
   */
  upstreamTimeoutMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_UPSTREAM_TIMEOUT_MS',
      DEFAULT_UPSTREAM_TIMEOUT_MS,
    );
  }

  /**
   * 从受控配置读取内部密钥。
   * @returns 从受控配置读取内部密钥。
   */
  internalSecret() {
    return this.getString('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET');
  }

  /**
   * 按运行时配置与路径参数构造RedisURL。
   * @returns 按参数编码并拼接完成的按运行时配置与路径参数构造RedisURL。
   */
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

  /**
   * 从受控配置读取公开的会话前缀。
   * @returns 按参数编码并拼接完成的从受控配置读取公开的会话前缀。
   */
  publicSessionPrefix() {
    return `${resolveNapcatWebuiPublicBaseUrl(
      this.getString('NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'),
    )}/session`;
  }

  /**
   * 按`key`读取字符串；从 `configService.get` 读取字符串。
   * @param key - 用于读取或更新字符串的稳定键。
   * @returns 字符串。
   */
  private getString(key: string) {
    return String(this.configService.get<string>(key) || '').trim();
  }

  /**
   * 读取正数配置；配置缺失、非有限数或不大于零时使用调用方兜底值。
   * @param key - 用于读取或更新正数配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 返回有效正数配置；缺失或非法时返回调用方提供的兜底值。
   */
  private getPositiveNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }
}
