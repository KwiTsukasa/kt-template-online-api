import axios, { type AxiosRequestConfig } from 'axios';

export interface EnvironmentReadonlyHttpClientOptions {
  bodyPreviewLimit?: number;
  timeoutMs?: number;
}

export interface EnvironmentReadonlyHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, unknown>;
  bodyPreview: string;
  observedAt: string;
}

const DEFAULT_BODY_PREVIEW_LIMIT = 512;
const DEFAULT_TIMEOUT_MS = 5000;
const SECRET_HEADER_PATTERN = /(authorization|cookie|token|secret|password)/i;

export type EnvironmentReadonlyHttpMethod = 'GET' | 'HEAD';

export interface EnvironmentReadonlyHttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
}

export class EnvironmentReadonlyHttpClient {
  private readonly bodyPreviewLimit: number;
  private readonly timeoutMs: number;

  constructor(options: EnvironmentReadonlyHttpClientOptions = {}) {
    const configuredTimeout = Number(
      process.env.ENV_DASHBOARD_SIGNAL_TIMEOUT_MS || '',
    );
    this.bodyPreviewLimit =
      options.bodyPreviewLimit ?? DEFAULT_BODY_PREVIEW_LIMIT;
    this.timeoutMs =
      options.timeoutMs ||
      (Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS);
  }

  /** 读取环境只读的HTTP记录。 */
  get(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('GET', url, options);
  }

  /** 返回头部。 */
  head(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('HEAD', url, options);
  }

  /** 请求环境只读的HTTP记录。 */
  async request(
    method: string,
    url: string,
    options: EnvironmentReadonlyHttpRequestOptions = {},
  ): Promise<EnvironmentReadonlyHttpResponse> {
    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
      throw new Error('环境总览只读 HTTP client 只允许 GET/HEAD 请求');
    }

    const config: AxiosRequestConfig = {
      headers: options.headers,
      method: normalizedMethod,
      params: options.params,
      timeout: this.timeoutMs,
      url,
    };
    const response = await axios.request(config);

    return {
      bodyPreview:
        normalizedMethod === 'HEAD' ? '' : this.toBodyPreview(response.data),
      headers: this.sanitizeHeaders(
        response.headers as Record<string, unknown>,
      ),
      observedAt: new Date().toISOString(),
      status: response.status,
      statusText: response.statusText,
    };
  }

  /** 返回到请求体预览。 */
  private toBodyPreview(body: unknown): string {
    const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
    if (text.length <= this.bodyPreviewLimit) return text;
    return `${text.slice(0, this.bodyPreviewLimit)}...`;
  }

  /** 清理请求头。 */
  private sanitizeHeaders(
    headers: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        SECRET_HEADER_PATTERN.test(key) ? '[redacted]' : value,
      ]),
    );
  }
}
