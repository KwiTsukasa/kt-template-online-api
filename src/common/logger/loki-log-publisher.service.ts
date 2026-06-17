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

  /**
   * 初始化 LokiLogPublisherService 实例。
   * @param configService - Nest ConfigService 依赖；驱动 `getAppName()`、`getLokiEnvironment()` 的 公共基础设施步骤。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
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
   * 执行 日志管道流程。
   * @param params - 公共基础设施列表；使用 `context`、`level`、`payload`、`error` 字段生成结果。
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
      ...(params.error ? { err: this.serializeError(params.error) } : {}),
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
   * 判断 日志管道条件。
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
   * 执行 日志管道流程。
   * @param body - 请求体 DTO；承载 公共基础设施新增、更新、导入或执行字段。
   */
  private requestPush(body: string) {
    const url = new URL(
      this.getConfig('LOKI_PUSH_ENDPOINT', '/loki/api/v1/push'),
      this.host,
    );

    return new Promise<void>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
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
   * 查询 日志管道数据。
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
   * 序列化Error。
   * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
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
   * 执行 日志管道流程。
   * @param timestampMs - 公共基础设施列表；驱动 `BigInt()` 的 公共基础设施步骤。
   */
  private toNanoseconds(timestampMs: number) {
    return `${BigInt(timestampMs) * 1000000n}`;
  }

  /**
   * 查询 日志管道数据。
   * @param key - 键名；限定 公共基础设施查询范围。
   * @param fallback - 兜底值；驱动 `toolsService.toTrimmedString()` 的 公共基础设施步骤。
   */
  private getConfig(key: string, fallback = '') {
    const value = this.configService.get<string>(key);
    return this.toolsService.toTrimmedString(value || fallback);
  }

  /**
   * 查询 日志管道数据。
   * @param key - 键名；驱动 `Number()` 的 公共基础设施步骤。
   * @param fallback - 兜底值；驱动 `Number.isFinite()` 的 公共基础设施步骤。
   */
  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * 转换 日志管道输入。
   * @param value - 待转换值；生成规范化文本。
   */
  private normalizeUrl(value: string) {
    return value.replace(/\/+$/g, '');
  }
}
