import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_GATEWAY_PORT = 48086;
const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_SESSION_TTL_MS = 60_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5000;
const MAX_TICKET_TTL_MS = 60_000;

@Injectable()
export class NapcatWebuiGatewayConfigService {
  /**
   * Creates the Gateway config facade around Nest ConfigService.
   * @param configService - Global Nest config service loaded from the current NODE_ENV file.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns the current wall-clock timestamp for session expiry decisions.
   * @returns Milliseconds since Unix epoch.
   */
  now() {
    return Date.now();
  }

  /**
   * Reads the browser Gateway session TTL.
   * @returns Positive TTL in milliseconds, defaulting to 60 seconds.
   */
  ttlMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_SESSION_TTL_MS',
      DEFAULT_SESSION_TTL_MS,
    );
  }

  /**
   * Reads and bounds the one-time bootstrap ticket TTL.
   * @returns Positive TTL in milliseconds, capped at 60 seconds.
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
   * Reads the standalone Gateway HTTP port.
   * @returns Positive port number, defaulting to 48086.
   */
  port() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_PORT',
      DEFAULT_GATEWAY_PORT,
    );
  }

  /**
   * Reads the bounded timeout for NapCat WebUI upstream HTTP calls.
   * @returns Positive timeout in milliseconds, defaulting to 5 seconds.
   */
  upstreamTimeoutMs() {
    return this.getPositiveNumber(
      'NAPCAT_WEBUI_GATEWAY_UPSTREAM_TIMEOUT_MS',
      DEFAULT_UPSTREAM_TIMEOUT_MS,
    );
  }

  /**
   * Reads the shared internal secret required for mutating API-to-Gateway calls.
   * @returns Trimmed secret or an empty string when missing so callers fail closed.
   */
  internalSecret() {
    return this.getString('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET');
  }

  /**
   * Builds the Redis URL from the explicit Gateway URL or host/port fallback.
   * @returns Redis connection URL for the Gateway process.
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
   * Reads the public route prefix used for relative iframe URLs.
   * @returns Gateway-owned public session route prefix without a trailing slash.
   */
  publicSessionPrefix() {
    return '/napcat-webui/session';
  }

  /**
   * Reads a trimmed string from the environment-backed config store.
   * @param key - Environment variable key.
   * @returns Trimmed string value or empty string.
   */
  private getString(key: string) {
    return String(this.configService.get<string>(key) || '').trim();
  }

  /**
   * Reads a positive numeric environment variable with a fallback.
   * @param key - Environment variable key.
   * @param fallback - Default value when the configured value is invalid.
   * @returns Positive finite number.
   */
  private getPositiveNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
