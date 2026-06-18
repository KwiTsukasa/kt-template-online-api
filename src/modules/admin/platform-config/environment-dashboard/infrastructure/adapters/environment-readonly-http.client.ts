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

  /**
   * Initializes the readonly HTTP client for environment probes.
   * @param options - Optional test/runtime tuning for timeout and evidence preview size.
   */
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

  /**
   * Performs a GET probe against a readonly integration endpoint.
   * @param url - Fully qualified URL from environment dashboard configuration.
   * @param options - Optional params and headers; secret headers are never returned.
   * @returns Sanitized HTTP evidence response.
   */
  get(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('GET', url, options);
  }

  /**
   * Performs a HEAD probe when body content is not needed.
   * @param url - Fully qualified URL from environment dashboard configuration.
   * @param options - Optional params and headers; secret headers are never returned.
   * @returns Sanitized HTTP evidence response without a body preview.
   */
  head(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('HEAD', url, options);
  }

  /**
   * Executes a bounded readonly HTTP request and rejects write methods.
   * @param method - Method supplied by the adapter; only GET and HEAD are accepted.
   * @param url - Fully qualified URL from non-secret runtime configuration.
   * @param options - Optional request params and headers used only for the outbound call.
   * @returns Sanitized status, headers, and truncated body preview for evidence storage.
   */
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

  /**
   * Converts arbitrary response bodies into a bounded evidence preview.
   * @param body - Axios response body from readonly integrations.
   * @returns Short text preview with an ellipsis when truncated.
   */
  private toBodyPreview(body: unknown): string {
    const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
    if (text.length <= this.bodyPreviewLimit) return text;
    return `${text.slice(0, this.bodyPreviewLimit)}...`;
  }

  /**
   * Removes secret-like response headers before they enter evidence.
   * @param headers - Headers returned by axios or a mocked adapter response.
   * @returns Header map with secret values replaced by a fixed redaction marker.
   */
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
