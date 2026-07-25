import axios, { type AxiosRequestConfig } from 'axios';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:48086';
const DEFAULT_GATEWAY_TIMEOUT_MS = 5000;
const GATEWAY_PUBLIC_SESSION_PREFIX = '/napcat-webui/session/';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_BOOTSTRAP_TICKET_PATTERN = /^[A-Za-z0-9._~-]+$/;
const UNSAFE_GATEWAY_RESULT_PATTERN =
  /(\bCredential\b|\bBearer\s+\S+|webui[_-]?token|(?:^|[?&\s])(token|secret|password|credential|captcha)=|https?:\/\/|\/\/|127\.0\.0\.1|localhost|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|:\d{2,5}\b|\bdocker\b|\bnas\b|\/vol\d\b|\/internal\/sessions\b)/i;

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

export type QqbotNapcatWebuiGatewayLifecycleRequest = {
  adminUserId: string;
  clientIp?: string;
  sessionId: string;
  userAgent?: string;
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
  constructor(private readonly configService: ConfigService) {}

  async createSession(input: QqbotNapcatWebuiGatewayCreateSessionRequest) {
    return this.validateSessionResult(
      await this.post<QqbotNapcatWebuiGatewaySessionResult>(
        '/internal/sessions',
        input,
      ),
    );
  }

  heartbeat(input: QqbotNapcatWebuiGatewayLifecycleRequest) {
    const { sessionId, ...data } = input;
    return this.post<QqbotNapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      data,
    );
  }

  revoke(input: QqbotNapcatWebuiGatewayLifecycleRequest) {
    const { sessionId, ...data } = input;
    return this.post<QqbotNapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/revoke`,
      data,
    );
  }

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

  private buildUrl(path: string) {
    return `${this.getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private getBaseUrl() {
    const configured = this.configService.get<string>(
      'NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL',
    );
    return (configured || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
  }

  private getHeaders() {
    const secret = this.getInternalSecret();

    return { 'x-kt-gateway-secret': secret };
  }

  private getInternalSecret() {
    const secret = String(
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET') ||
        '',
    ).trim();

    if (!secret) {
      throwVbenError(
        'NapCat WebUI Gateway 内部密钥未配置',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return secret;
  }

  private getTimeoutMs() {
    const configured = Number(
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS') || '',
    );

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_GATEWAY_TIMEOUT_MS;
  }

  private unwrapGatewayBody<T>(body: GatewayResponseBody<T>): T {
    if (body && typeof body === 'object' && 'data' in body) {
      return (body as { data: T }).data;
    }

    return body as T;
  }

  private validateSessionResult(
    result: QqbotNapcatWebuiGatewaySessionResult,
  ): QqbotNapcatWebuiGatewaySessionResult {
    if (!result || typeof result !== 'object') {
      this.throwInvalidSessionResult();
    }

    const sessionId = String(result.sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      this.throwInvalidSessionResult();
    }
    if (!Number.isFinite(result.expiresAt)) {
      this.throwInvalidSessionResult();
    }
    if (!this.isSafeIframeUrl(result.iframeUrl, sessionId)) {
      this.throwInvalidSessionResult();
    }

    return {
      expiresAt: result.expiresAt,
      iframeUrl: result.iframeUrl,
      sessionId,
    };
  }

  private isSafeIframeUrl(iframeUrl: unknown, sessionId: string) {
    if (typeof iframeUrl !== 'string' || iframeUrl.trim() !== iframeUrl) {
      return false;
    }
    if (!iframeUrl.startsWith(GATEWAY_PUBLIC_SESSION_PREFIX)) return false;
    if (iframeUrl.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(iframeUrl)) {
      return false;
    }
    if (iframeUrl.includes('\\')) return false;

    const queryStart = iframeUrl.indexOf('?');
    const path =
      queryStart >= 0 ? iframeUrl.slice(0, queryStart) : iframeUrl;
    const query = queryStart >= 0 ? iframeUrl.slice(queryStart + 1) : '';
    const expectedPrefix = `${GATEWAY_PUBLIC_SESSION_PREFIX}${sessionId}/`;
    if (!path.startsWith(expectedPrefix)) return false;

    const isBootstrapRoute = path === `${expectedPrefix}bootstrap`;
    if (query.includes('?') || /%3f/i.test(query)) return false;
    if (query && this.hasUnsafeGatewayEvidence(query)) return false;

    const params = new URLSearchParams(query);
    const entries = [...params.entries()];
    const ticketValues = params.getAll('ticket');
    if (query) {
      if (!isBootstrapRoute) return false;
      if (entries.length !== 1 || ticketValues.length !== 1) return false;
      const [key, ticket] = entries[0];
      if (key !== 'ticket') return false;
      if (!SAFE_BOOTSTRAP_TICKET_PATTERN.test(ticket)) return false;
    } else if (/ticket/i.test(iframeUrl)) {
      return false;
    }

    const unsafeScanValue = query
      ? `${path}?ticket=`
      : iframeUrl;
    return !this.hasUnsafeGatewayEvidence(unsafeScanValue);
  }

  private hasUnsafeGatewayEvidence(value: string) {
    const decoded = this.tryDecodeURIComponent(value);
    return UNSAFE_GATEWAY_RESULT_PATTERN.test(decoded);
  }

  private tryDecodeURIComponent(value: string) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private throwInvalidSessionResult(): never {
    return throwVbenError(
      'NapCat WebUI Gateway 返回无效会话',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
