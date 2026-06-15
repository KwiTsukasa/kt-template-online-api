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

@Injectable()
export class QqbotPluginHttpClientService {
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
}

function createPluginHttpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    response: {
      status: statusCode,
    },
    statusCode,
  });
}
