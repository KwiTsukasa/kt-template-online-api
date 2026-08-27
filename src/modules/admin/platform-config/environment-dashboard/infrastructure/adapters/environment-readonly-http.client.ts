import { Agent as HttpsAgent } from 'node:https';
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
  allowSelfSignedTls?: boolean;
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
      ((() => {
        if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
          return configuredTimeout;
        }
        return DEFAULT_TIMEOUT_MS;
      })());
  }

  /**
   * 按`url`、`options`读取环境只读的HTTP记录；从受控资源来源加载所需数据（`request`）。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param options - 控制环境只读的HTTP记录筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
   * @returns 环境只读的HTTP记录。
   */
  get(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('GET', url, options);
  }

  /**
   * 根据`url`、`options`处理只读 HEAD 查询并写回头部；从受控资源来源加载所需数据（`request`）。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param options - 控制只读 HEAD 查询并写回头部筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
   * @returns 只读 HEAD 查询并写回头部。
   */
  head(url: string, options: EnvironmentReadonlyHttpRequestOptions = {}) {
    return this.request('HEAD', url, options);
  }

  /**
   * 按`method`、`url`、`options`投递环境只读的HTTP记录；从受控资源来源加载所需数据（`axios.request`）。
   * @param method - 决定环境只读的HTTP记录内容、边界或目标的 `method` 值。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param options - 控制环境只读的HTTP记录筛选、缓存或输出方式的可选项，包含 `headers`、`params` 字段；省略时默认采用 `{}`。
   * @returns 包含 `bodyPreview`、`headers`、`observedAt`、`status`、`statusText` 字段的环境只读的HTTP记录。
   * @throws 当 `normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD'` 成立时拒绝当前输入并抛出 `Error`。
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
    if (options.allowSelfSignedTls === true) {
      const target = new URL(url);
      if (target.protocol !== 'https:') {
        throw new Error('自签 TLS 兼容只允许显式 HTTPS 请求');
      }
      config.httpsAgent = new HttpsAgent({ rejectUnauthorized: false });
    }
    const response = await axios.request(config);

    return {
      bodyPreview:
        (() => {
          if (normalizedMethod === 'HEAD') {
            return '';
          }
          return this.toBodyPreview(response.data);
        })(),
      headers: this.sanitizeHeaders(
        response.headers as Record<string, unknown>,
      ),
      observedAt: new Date().toISOString(),
      status: response.status,
      statusText: response.statusText,
    };
  }

  /**
   * 把响应体转换为文本预览，并以配置上限截断过长内容，避免仪表盘承载完整大响应。
   * @param body - 待转换为预览的响应体；非字符串值按 JSON 序列化。
   * @returns 未超限时返回完整文本，超限时返回截断内容并追加省略号。
   */
  private toBodyPreview(body: unknown): string {
    const text = (() => {
      if (typeof body === 'string') {
        return body;
      }
      return JSON.stringify(body ?? '');
    })();
    if (text.length <= this.bodyPreviewLimit) return text;
    return `${text.slice(0, this.bodyPreviewLimit)}...`;
  }

  /**
   * 将`headers`规范为请求头，使等价输入得到一致表示。
   * @param headers - 决定请求头内容、边界或目标的 `headers` 值；省略时默认采用 `{}`。
   * @returns 请求头。
   */
  private sanitizeHeaders(
    headers: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        (() => {
          if (SECRET_HEADER_PATTERN.test(key)) {
            return '[redacted]';
          }
          return value;
        })(),
      ]),
    );
  }
}
