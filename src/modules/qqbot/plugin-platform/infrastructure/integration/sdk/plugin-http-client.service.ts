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
   * 从`input`解析重定向；当 `!location` 成立时返回 `{ finalUrl: currentUrl.toString(), redirect…`。
   * @param input - 用于重定向的结构化输入，包含 `url`、`maxRedirects` 字段。
   * @returns 包含 `finalUrl`、`redirects` 字段的重定向。
   * @throws 当 `redirects.length >= maxRedirects` 成立时拒绝当前输入并抛出 `Error`。
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
   * 复用文本请求读取插件接口并解析 JSON；响应文本非法时使用调用方错误文案拒绝。
   * @param input - 用于JSON 数据的结构化输入，包含 `invalidJsonMessage`、`context` 字段。
   * @returns JSON 数据。
   * @throws 当 `JSON.parse` 调用失败时拒绝当前输入并抛出 `Error`。
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
   * 按 URL 协议、方法、请求头与超时发起插件 HTTP 请求，并将成功响应合并为 Buffer。
   * @param input - 用于缓冲区的结构化输入，包含 `url`、`method`、`timeoutMs`、`context` 字段。
   * @returns 完成初始化并携带当前边界配置的缓冲区。
   */
  requestBuffer(input: QqbotPluginHttpClientRequest): Promise<Buffer> {
    const url = (() => {
      if (input.url instanceof URL) {
        return input.url;
      }
      return new URL(input.url);
    })();
    const method = input.method || 'GET';
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 接口';

    return new Promise<Buffer>((resolve, reject) => {
      const client = (() => {
        if (url.protocol === 'http:') {
          return http;
        }
        return https;
      })();
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
            chunks.push((() => {
              if (Buffer.isBuffer(chunk)) {
                return chunk;
              }
              return Buffer.from(chunk);
            })());
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
   * 按 URL 协议、方法、请求头与超时发起插件 HTTP 请求，并将成功响应解码为文本。
   * @param input - 用于文本的结构化输入，包含 `url`、`method`、`timeoutMs`、`context` 字段。
   * @returns 完成初始化并携带当前边界配置的文本。
   */
  requestText(input: QqbotPluginHttpClientRequest): Promise<string> {
    const url = (() => {
      if (input.url instanceof URL) {
        return input.url;
      }
      return new URL(input.url);
    })();
    const method = input.method || 'GET';
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 接口';

    return new Promise<string>((resolve, reject) => {
      const client = (() => {
        if (url.protocol === 'http:') {
          return http;
        }
        return https;
      })();
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
   * 按`url`、`input`投递重定向位置。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param input - 用于重定向位置的结构化输入，包含 `timeoutMs`、`context`、`headers`、`failureMessage` 字段。
   * @returns 完成初始化并携带当前边界配置的重定向位置；没有可用结果或提前结束时为 `undefined`。
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
 * 将错误消息与 HTTP 状态码附加到 `Error` 对象，并同时暴露 Axios 风格的 `response.status`。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 * @param statusCode - 决定插件Http错误内容、边界或目标的 `statusCode` 值。
 * @returns 插件Http错误。
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
 * 将`value`规范为插件HTTPURL，使等价输入得到一致表示。
 * @param value - 待转换为插件HTTPURL的原始值。
 * @returns 插件HTTPURL。
 * @throws 当 `url.protocol !== 'http:' && url.protocol !== 'https:'` 成立时拒绝当前输入并抛出 `Error`。
 */
function normalizePluginHttpUrl(value: string | URL) {
  const url = (() => {
    if (value instanceof URL) {
      return value;
    }
    return new URL(value);
  })();
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('插件 HTTP 重定向仅支持 http/https');
  }
  return url;
}

/**
 * 将`value`规范为最大重定向，使等价输入得到一致表示；当 `Number.isFinite(maxRedirects) && maxRedirects >= 0` 成立时返回 `Math.floor(maxRedirects)`。
 * @param value - 待转换为最大重定向的原始值。
 * @returns 当前状态对应的最大重定向，取值为 `5`。
 */
function normalizeMaxRedirects(value: number | undefined) {
  const maxRedirects = value ?? 5;
  if (Number.isFinite(maxRedirects) && maxRedirects >= 0) {
    return Math.floor(maxRedirects);
  }
  return 5;
}

/**
 * 按`url`读取插件HTTP模块；当 `url.protocol === 'http:'` 成立时返回 `http`。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 插件HTTP模块。
 */
function getPluginHttpModule(url: URL) {
  if (url.protocol === 'http:') {
    return http;
  }
  return https;
}
