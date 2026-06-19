import { Injectable } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';

export type QqbotPluginHttpClientRequest = {
  body?: Buffer | string;
  context?: string;
  failureMessage?: (statusCode: number) => string;
  headers?: Record<string, string>;
  invalidJsonMessage?: string;
  method?: string;
  timeoutMessage?: string;
  timeoutMs?: number;
  url: string | URL;
};

export type QqbotPluginResolveRedirectRequest = {
  context?: string;
  failureMessage?: (statusCode: number) => string;
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMessage?: string;
  timeoutMs?: number;
  url: string | URL;
};

export type QqbotPluginRedirectResult = {
  finalUrl: string;
  redirects: string[];
};

@Injectable()
export class QqbotPluginHttpClientService {
  /**
   * Resolves an HTTP(S) URL through bounded 3xx redirects for plugin host calls without platform-specific URL rules.
   * @param input - Initial URL, optional headers, timeout, and redirect limit supplied by plugin runtime code.
   * @returns Final URL and the ordered chain of redirect target URLs.
   */
  async resolveRedirect(
    input: QqbotPluginResolveRedirectRequest,
  ): Promise<QqbotPluginRedirectResult> {
    let currentUrl = normalizePluginHttpUrl(input.url);
    const redirects: string[] = [];
    const maxRedirects = normalizeMaxRedirects(input.maxRedirects);

    while (true) {
      const location = await this.requestRedirectLocation(currentUrl, input);
      if (!location) {
        return {
          finalUrl: currentUrl.toString(),
          redirects,
        };
      }

      if (redirects.length >= maxRedirects) {
        throw new Error('插件 HTTP 重定向超过上限');
      }

      currentUrl = normalizePluginHttpUrl(new URL(location, currentUrl));
      redirects.push(currentUrl.toString());
    }
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param input - input 输入；使用 `invalidJsonMessage`、`context` 字段生成结果。
   * @returns 异步完成后的 QQBot 插件平台结果。
   */
  async requestJson<T>(input: QqbotPluginHttpClientRequest): Promise<T> {
    const body = await this.requestText(input);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(
        input.invalidJsonMessage ||
          `${input.context || '插件 HTTP 接口'}返回不是合法 JSON`,
      );
    }
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param input - input 输入；使用 `url`、`method`、`timeoutMs`、`context` 字段生成结果。
   * @returns QQBot 插件平台渲染后的图片、画布或文本。
   */
  requestBuffer(input: QqbotPluginHttpClientRequest): Promise<Buffer> {
    const url = input.url instanceof URL ? input.url : new URL(input.url);
    const method = input.method || 'GET';
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 接口';

    return new Promise<Buffer>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: '*/*',
            'User-Agent': 'kt-template-online-api/qqbot-plugin',
            ...(input.headers || {}),
          },
          method,
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on('end', () => {
            const statusCode = response.statusCode || 500;
            if (statusCode >= 400) {
              reject(
                createPluginHttpError(
                  input.failureMessage?.(statusCode) ||
                    `${context}请求失败：${statusCode}`,
                  statusCode,
                ),
              );
              return;
            }
            resolve(Buffer.concat(chunks));
          });
        },
      );
      request.on('timeout', () => {
        request.destroy(
          new Error(input.timeoutMessage || `${context}请求超时`),
        );
      });
      request.on('error', reject);
      if (input.body) request.write(input.body);
      request.end();
    });
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param input - input 输入；使用 `url`、`method`、`timeoutMs`、`context` 字段生成结果。
   * @returns QQBot 插件平台渲染后的图片、画布或文本。
   */
  requestText(input: QqbotPluginHttpClientRequest): Promise<string> {
    const url = input.url instanceof URL ? input.url : new URL(input.url);
    const method = input.method || 'GET';
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 接口';

    return new Promise<string>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'kt-template-online-api/qqbot-plugin',
            ...(input.headers || {}),
          },
          method,
          timeout: timeoutMs,
        },
        (response) => {
          let responseBody = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            responseBody += chunk;
          });
          response.on('end', () => {
            const statusCode = response.statusCode || 500;
            if (statusCode >= 400) {
              reject(
                createPluginHttpError(
                  input.failureMessage?.(statusCode) ||
                    `${context}请求失败：${statusCode}`,
                  statusCode,
                ),
              );
              return;
            }
            resolve(responseBody);
          });
        },
      );
      request.on('timeout', () => {
        request.destroy(
          new Error(input.timeoutMessage || `${context}请求超时`),
        );
      });
      request.on('error', reject);
      if (input.body) request.write(input.body);
      request.end();
    });
  }

  /**
   * Requests one URL and returns its redirect Location after the response body is drained.
   * @param url - Validated HTTP(S) URL to request.
   * @param input - Headers and timeout options shared across the redirect chain.
   * @returns Redirect Location header when the response is 3xx, otherwise `undefined`; rejects for HTTP error statuses.
   */
  private requestRedirectLocation(
    url: URL,
    input: QqbotPluginResolveRedirectRequest,
  ): Promise<string | undefined> {
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 重定向';

    return new Promise<string | undefined>((resolve, reject) => {
      const client = getPluginHttpModule(url);
      const request = client.request(
        url,
        {
          headers: {
            Accept: '*/*',
            'User-Agent': 'kt-template-online-api/qqbot-plugin',
            ...(input.headers || {}),
          },
          method: 'GET',
          timeout: timeoutMs,
        },
        (response) => {
          const statusCode = response.statusCode || 0;
          const location = response.headers.location;

          response.on('error', reject);
          response.on('end', () => {
            if (statusCode >= 400) {
              reject(
                createPluginHttpError(
                  input.failureMessage?.(statusCode) ||
                    `${context}请求失败：${statusCode}`,
                  statusCode,
                ),
              );
              return;
            }
            if (
              statusCode >= 300 &&
              statusCode < 400 &&
              typeof location === 'string' &&
              location.trim()
            ) {
              resolve(location);
              return;
            }
            resolve(undefined);
          });
          response.resume();
        },
      );
      request.on('timeout', () => {
        request.destroy(
          new Error(input.timeoutMessage || `${context}请求超时`),
        );
      });
      request.on('error', reject);
      request.end();
    });
  }
}

/**
 * 创建 QQBot 插件平台对象或配置。
 * @param message - message 输入；驱动 `Object.assign()` 的 插件平台步骤。
 * @param statusCode - statusCode 输入；生成 插件平台对象。
 */
function createPluginHttpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    response: {
      status: statusCode,
    },
    statusCode,
  });
}

/**
 * Builds a URL and enforces the plugin redirect resolver's HTTP(S)-only protocol boundary.
 * @param value - Worker-supplied string or URL value.
 * @returns URL instance safe to request with node:http or node:https.
 */
function normalizePluginHttpUrl(value: string | URL) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('插件 HTTP 重定向仅支持 http/https');
  }
  return url;
}

/**
 * Normalizes the redirect limit used to stop infinite or overly long redirect chains.
 * @param value - Optional max redirect count supplied by plugin runtime code.
 * @returns Non-negative redirect count limit.
 */
function normalizeMaxRedirects(value: number | undefined) {
  const maxRedirects = value ?? 5;
  return Number.isFinite(maxRedirects) && maxRedirects >= 0
    ? Math.floor(maxRedirects)
    : 5;
}

/**
 * Selects the Node HTTP module for a validated redirect URL.
 * @param url - HTTP(S) URL accepted by `normalizePluginHttpUrl`.
 * @returns Node request module matching the URL protocol.
 */
function getPluginHttpModule(url: URL) {
  return url.protocol === 'http:' ? http : https;
}
