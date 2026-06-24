import axios, { type AxiosRequestConfig } from 'axios';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:48086';
const DEFAULT_GATEWAY_TIMEOUT_MS = 5000;

export type QqbotNapcatWebuiGatewayCreateSessionRequest = {
  accountId: string;
  adminUserId: string;
  clientIp?: string;
  containerId: string;
  containerName: string;
  selfId: string;
  upstreamBaseUrl: string;
  userAgent?: string;
  webuiToken: string;
};

export type QqbotNapcatWebuiGatewaySessionResult = {
  expiresAt: number;
  iframeUrl: string;
  sessionId: string;
};

export type QqbotNapcatWebuiGatewayLifecycleResult = Record<string, unknown>;

type GatewayResponseBody<T> = T | { data: T };

@Injectable()
export class QqbotNapcatWebuiGatewayClient {
  /**
   * Creates the internal Gateway client backed by bounded axios requests.
   * @param configService - Nest config source for Gateway base URL, internal secret, and timeout.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a proxied NapCat WebUI session through the internal Gateway.
   * @param input - Server-only target metadata, including WebUI token and upstream endpoint.
   * @returns Browser-safe Gateway session metadata.
   */
  createSession(input: QqbotNapcatWebuiGatewayCreateSessionRequest) {
    return this.post<QqbotNapcatWebuiGatewaySessionResult>(
      '/internal/sessions',
      input,
    );
  }

  /**
   * Refreshes one Gateway session heartbeat without exposing internal target data.
   * @param sessionId - Gateway session id previously returned to Admin.
   * @returns Gateway lifecycle response body.
   */
  heartbeat(sessionId: string) {
    return this.post<QqbotNapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    );
  }

  /**
   * Revokes one Gateway session without exposing internal target data.
   * @param sessionId - Gateway session id previously returned to Admin.
   * @returns Gateway lifecycle response body.
   */
  revoke(sessionId: string) {
    return this.post<QqbotNapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/revoke`,
    );
  }

  /**
   * Sends one bounded POST request to the internal Gateway and strips raw axios errors.
   * @param path - Internal Gateway path starting with `/internal`.
   * @param data - Optional JSON payload sent only server-to-server.
   * @returns Unwrapped Gateway response data.
   */
  private async post<T>(path: string, data?: unknown): Promise<T> {
    const config: AxiosRequestConfig = {
      data,
      headers: this.getHeaders(),
      method: 'POST',
      timeout: this.getTimeoutMs(),
      url: this.buildUrl(path),
    };

    try {
      const response = await axios.request<GatewayResponseBody<T>>(config);
      return this.unwrapGatewayBody<T>(response.data);
    } catch {
      throwVbenError(
        'NapCat WebUI Gateway 请求失败',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Builds the complete Gateway URL from a configured base URL and fixed internal path.
   * @param path - Internal Gateway path supplied by the service method.
   * @returns Absolute Gateway URL without duplicate slashes.
   */
  private buildUrl(path: string) {
    return `${this.getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * Reads and normalizes the internal Gateway base URL.
   * @returns Configured base URL or the local Gateway default.
   */
  private getBaseUrl() {
    const configured = this.configService.get<string>(
      'NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL',
    );
    return (configured || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * Reads the optional Gateway shared secret and maps it to the internal header.
   * @returns Header map when a secret is configured, otherwise undefined.
   */
  private getHeaders() {
    const secret = (
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET') ||
      ''
    ).trim();

    return secret ? { 'x-kt-gateway-secret': secret } : undefined;
  }

  /**
   * Reads and validates the Gateway request timeout.
   * @returns Positive timeout in milliseconds.
   */
  private getTimeoutMs() {
    const configured = Number(
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS') || '',
    );

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_GATEWAY_TIMEOUT_MS;
  }

  /**
   * Accepts both raw Gateway bodies and Vben-like `{ data }` wrappers.
   * @param body - Axios response body returned by the internal Gateway.
   * @returns The unwrapped data payload expected by API callers.
   */
  private unwrapGatewayBody<T>(body: GatewayResponseBody<T>): T {
    if (body && typeof body === 'object' && 'data' in body) {
      return (body as { data: T }).data;
    }

    return body as T;
  }
}
