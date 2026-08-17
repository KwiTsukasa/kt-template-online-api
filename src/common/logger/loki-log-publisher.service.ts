import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { ToolsService } from '../services/tool.service';
import { getAppName, getLokiEnvironment } from './pino-logger.config';

type LokiLogLevel = 'critical' | 'debug' | 'error' | 'info' | 'warning';

type LokiPushLogParams = {
  context: string;
  error?: unknown;
  level: LokiLogLevel;
  message: string;
  payload: Record<string, unknown>;
};

const PINO_LEVEL_VALUES: Record<LokiLogLevel, number> = {
  critical: 60,
  debug: 20,
  error: 50,
  info: 30,
  warning: 40,
};

@Injectable()
export class LokiLogPublisherService {
  private readonly appName: string;
  private readonly environment: string;
  private readonly host: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {
    this.appName = getAppName(configService);
    this.environment = getLokiEnvironment(configService);
    this.host = this.normalizeUrl(
      this.getConfig('LOKI_HOST') || this.getConfig('LOKI_URL'),
    );
  }

  /**
   * 将`params`中的非空针对日志管道截断到安全上限后追加到目标集合。
   * @param params - 用于针对日志管道的领域对象，包含 `context`、`level`、`payload`、`error` 字段。
   */
  async pushHttpRequestLog(params: LokiPushLogParams) {
    if (!this.isEnabled()) return;

    const timestampMs = Date.now();
    const stream = {
      app: this.appName,
      context: params.context,
      env: this.environment,
      level: params.level,
      service: 'api',
    };
    const line = JSON.stringify({
      level: PINO_LEVEL_VALUES[params.level],
      time: timestampMs,
      app: this.appName,
      env: this.environment,
      context: params.context,
      ...params.payload,
      ...((() => {
        if (params.error) {
          return { err: this.serializeError(params.error) };
        }
        return {};
      })()),
      msg: params.message,
    });
    const body = JSON.stringify({
      streams: [
        {
          stream,
          values: [[this.toNanoseconds(timestampMs), line]],
        },
      ],
    });

    await this.requestPush(body);
  }

  /**
   * 根据当前运行态与当前约束判定针对日志管道；从 `configService.get` 读取针对日志管道。
   * @returns 满足针对日志管道约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isEnabled() {
    return (
      !!this.host &&
      this.toolsService.normalizeBoolean(
        this.configService.get<string>('LOKI_HTTP_REQUEST_PUSH_ENABLED'),
        true,
      )
    );
  }

  /**
   * 按`body`投递针对日志管道；从 `getConfig` 读取针对日志管道。
   * @param body - 用于针对日志管道的结构化输入。
   * @returns 完成初始化并携带当前边界配置的针对日志管道。
   */
  private requestPush(body: string) {
    const url = new URL(
      this.getConfig('LOKI_PUSH_ENDPOINT', '/loki/api/v1/push'),
      this.host,
    );

    return new Promise<void>((resolve, reject) => {
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
            'Content-Length': Buffer.byteLength(body),
            'Content-Type': 'application/json',
            'User-Agent': 'kt-template-online-api/loki-log-publisher',
            ...this.getHeaders(),
          },
          method: 'POST',
          timeout: this.getNumberConfig('LOKI_PUSH_TIMEOUT_MS', 30000),
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            if ((response.statusCode || 500) >= 400) {
              reject(new Error(`Loki 写入失败：${response.statusCode}`));
              return;
            }
            resolve();
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Loki 写入超时'));
      });
      request.on('error', reject);
      request.end(body);
    });
  }

  /**
   * 按当前运行态读取针对日志管道；从 `getConfig` 读取针对日志管道。
   * @returns 针对日志管道。
   */
  private getHeaders() {
    const headers: Record<string, string> = {};
    const tenantId = this.getConfig('LOKI_TENANT_ID');
    const username = this.getConfig('LOKI_USERNAME');
    const password = this.getConfig('LOKI_PASSWORD');

    if (tenantId) headers['X-Scope-OrgID'] = tenantId;
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(
        `${username}:${password}`,
      ).toString('base64')}`;
    }

    return headers;
  }

  /**
   * 将未知异常投影为可写入 Loki 的结构，对 `Error` 保留名称与堆栈。
   * @param error - 待记录的任意异常值；非 `Error` 值通过统一错误消息提取器转为文本。
   * @returns 返回至少含错误消息的日志对象；`Error` 输入额外包含名称与可选堆栈。
   */
  private serializeError(error: unknown) {
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    return {
      message: this.toolsService.getErrorMessage(error),
    };
  }

  /**
   * 将`timestampMs`转换为针对日志管道。
   * @param timestampMs - 用于针对日志管道超时、有效期或退避计算的毫秒数。
   * @returns 按参数编码并拼接完成的针对日志管道。
   */
  private toNanoseconds(timestampMs: number) {
    return `${BigInt(timestampMs) * 1000000n}`;
  }

  /**
   * 按`key`、`fallback`读取针对日志管道；从 `configService.get` 读取针对日志管道。
   * @param key - 用于读取或更新针对日志管道的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 针对日志管道。
   */
  private getConfig(key: string, fallback = '') {
    const value = this.configService.get<string>(key);
    return this.toolsService.toTrimmedString(value || fallback);
  }

  /**
   * 按`key`、`fallback`读取针对日志管道；当 `Number.isFinite(value) && value > 0` 成立时返回 `value`。
   * @param key - 用于读取或更新针对日志管道的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 针对日志管道。
   */
  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  /**
   * 将`value`规范为针对日志管道，使等价输入得到一致表示。
   * @param value - 待转换为针对日志管道的原始值。
   * @returns 针对日志管道。
   */
  private normalizeUrl(value: string) {
    return value.replace(/\/+$/g, '');
  }
}
