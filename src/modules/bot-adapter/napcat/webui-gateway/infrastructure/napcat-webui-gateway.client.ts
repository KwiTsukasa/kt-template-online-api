import axios, { type AxiosRequestConfig } from 'axios';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveNapcatWebuiPublicBaseUrl } from '@/apps/napcat-webui-gateway/config/napcat-webui-public-prefix';
import { throwVbenError } from '@/common';

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:48086';
const DEFAULT_GATEWAY_TIMEOUT_MS = 5000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_BOOTSTRAP_TICKET_PATTERN = /^[A-Za-z0-9._~-]+$/;
const UNSAFE_GATEWAY_RESULT_PATTERN =
  /(\bCredential\b|\bBearer\s+\S+|webui[_-]?token|(?:^|[?&\s])(token|secret|password|credential|captcha)=|https?:\/\/|\/\/|127\.0\.0\.1|localhost|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|:\d{2,5}\b|\bdocker\b|\bnas\b|\/vol\d\b|\/internal\/sessions\b)/i;

export type NapcatWebuiGatewayCreateSessionRequest = {
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

export type NapcatWebuiGatewayLifecycleRequest = {
  adminUserId: string;
  clientIp?: string;
  sessionId: string;
  userAgent?: string;
};

export type NapcatWebuiGatewaySessionResult = {
  expiresAt: number;
  iframeUrl: string;
  sessionId: string;
};

export type NapcatWebuiGatewayLifecycleResult = Record<string, unknown>;

type GatewayResponseBody<T> = T | { data: T };

@Injectable()
export class NapcatWebuiGatewayClient {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 根据`input`构造NapCat WebUI 网关会话；向目标通道投递结果（`post`）。
   * @param input - 用于NapCat WebUI 网关会话的结构化输入。
   * @returns NapCat WebUI 网关会话。
   */
  async createSession(input: NapcatWebuiGatewayCreateSessionRequest) {
    return this.validateSessionResult(
      await this.post<NapcatWebuiGatewaySessionResult>(
        '/internal/sessions',
        input,
      ),
    );
  }

  /**
   * 使用会话标识提交心跳续期请求，并返回续期后的会话状态。
   * @param input - 提供 `{ sessionId, ...data }` 的结构化领域输入。
   * @returns 返回续期后的网关会话状态或对应的成功响应。
   */
  heartbeat(input: NapcatWebuiGatewayLifecycleRequest) {
    const { sessionId, ...data } = input;
    return this.post<NapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      data,
    );
  }

  /**
   * 按`input`移除BotNapCatWebUI记录；向目标通道投递结果（`post`）。
   * @param input - 用于BotNapCatWebUI记录的结构化输入。
   * @returns BotNapCatWebUI记录。
   */
  revoke(input: NapcatWebuiGatewayLifecycleRequest) {
    const { sessionId, ...data } = input;
    return this.post<NapcatWebuiGatewayLifecycleResult>(
      `/internal/sessions/${encodeURIComponent(sessionId)}/revoke`,
      data,
    );
  }

  /**
   * 携带内部密钥向 NapCat WebUI 网关发送有超时边界的 POST 请求，并解包响应数据。
   * @param path - 必须保持在受控根目录内的路径。
   * @param data - 决定post内容、边界或目标的 `data` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回网关响应解包后的业务数据。
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
      throwVbenError('NapCat WebUI Gateway 请求失败', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 将网关基础地址与请求路径拼接，并确保路径边界只有一个起始斜杠。
   * @param path - 相对于 NapCat WebUI 网关基础地址的请求路径。
   * @returns 可直接交给 HTTP 客户端的完整网关 URL。
   */
  private buildUrl(path: string) {
    return `${this.getBaseUrl()}${(() => {
      if (path.startsWith('/')) {
        return path;
      }
      return `/${path}`;
    })()}`;
  }

  /**
   * 按当前运行态读取BaseURL 地址；从 `configService.get` 读取BaseURL 地址。
   * @returns BaseURL 地址。
   */
  private getBaseUrl() {
    const configured = this.configService.get<string>(
      'NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL',
    );
    return (configured || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * 按当前运行态读取请求头；从 `getInternalSecret` 读取请求头。
   * @returns 包含 `x-kt-gateway-secret` 字段的请求头。
   */
  private getHeaders() {
    const secret = this.getInternalSecret();

    return { 'x-kt-gateway-secret': secret };
  }

  /**
   * 按当前运行态读取内部密钥；从 `configService.get` 读取内部密钥。
   * @returns 内部密钥。
   */
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

  /**
   * 按当前运行态读取超时毫秒；当 `Number.isFinite(configured) && configured > 0` 成立时返回 `configured`。
   * @returns 超时毫秒。
   */
  private getTimeoutMs() {
    const configured = Number(
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_TIMEOUT_MS') || '',
    );

    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return DEFAULT_GATEWAY_TIMEOUT_MS;
  }

  /**
   * 将输入收敛并投影为网关请求体。
   * @param body - 用于网关请求体的结构化输入。
   * @returns 网关请求体。
   */
  private unwrapGatewayBody<T>(body: GatewayResponseBody<T>): T {
    if (body && typeof body === 'object' && 'data' in body) {
      return (body as { data: T }).data;
    }

    return body as T;
  }

  /**
   * 校验`result`是否满足会话结果约束，并拒绝不合法输入。
   * @param result - 用于会话结果的领域对象，包含 `sessionId`、`expiresAt`、`iframeUrl` 字段。
   * @returns 包含 `expiresAt`、`iframeUrl`、`sessionId` 字段的会话。
   */
  private validateSessionResult(
    result: NapcatWebuiGatewaySessionResult,
  ): NapcatWebuiGatewaySessionResult {
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

  /**
   * 根据`iframeUrl`、`sessionId`与当前约束判定安全内联框架URL；当 `typeof iframeUrl !== 'string' || iframeUrl.trim() !== iframeU…` 成立时返回 `false`。
   * @param iframeUrl - 待规范化、请求或同源校验的iframeURL 地址 URL。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 满足安全内联框架URL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isSafeIframeUrl(iframeUrl: unknown, sessionId: string) {
    if (typeof iframeUrl !== 'string' || iframeUrl.trim() !== iframeUrl) {
      return false;
    }
    const publicSessionPrefix = `${resolveNapcatWebuiPublicBaseUrl(
      this.configService.get<string>('NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL'),
    )}/session/`;
    if (!iframeUrl.startsWith(publicSessionPrefix)) return false;
    if (iframeUrl.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(iframeUrl)) {
      return false;
    }
    if (iframeUrl.includes('\\')) return false;

    const queryStart = iframeUrl.indexOf('?');
    const path = (() => {
      if (queryStart >= 0) {
        return iframeUrl.slice(0, queryStart);
      }
      return iframeUrl;
    })();
    const query = (() => {
      if (queryStart >= 0) {
        return iframeUrl.slice(queryStart + 1);
      }
      return '';
    })();
    const expectedPrefix = `${publicSessionPrefix}${sessionId}/`;
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

    const unsafeScanValue = (() => {
      if (query) {
        return `${path}?ticket=`;
      }
      return iframeUrl;
    })();
    return !this.hasUnsafeGatewayEvidence(unsafeScanValue);
  }

  /**
   * 根据`value`与当前约束判定不安全的网关证据是否存在。
   * @param value - 待判定是否满足不安全的网关证据是否存在约束的候选值。
   * @returns 满足不安全的网关证据是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private hasUnsafeGatewayEvidence(value: string) {
    const decoded = this.tryDecodeURIComponent(value);
    return UNSAFE_GATEWAY_RESULT_PATTERN.test(decoded);
  }

  /**
   * 根据`value`处理尝试解码URI组件。
   * @param value - 参与尝试解码URI组件比较、格式化或输出的候选值。
   * @returns 尝试解码URI组件。
   */
  private tryDecodeURIComponent(value: string) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /**
   * 以统一异常拒绝无效的会话结果。
   * @returns 以统一异常拒绝无效的会话。
   */
  private throwInvalidSessionResult(): never {
    return throwVbenError(
      'NapCat WebUI Gateway 返回无效会话',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
