import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { ConfigService } from '@nestjs/config';

const DEFAULT_APP_NAME = 'kt-template-online-api';
const PASSWORD_FIELDS = new Set([
  'password',
  'loginPassword',
]);
const REDACTION_FAILURE_RECORD = JSON.stringify({
  level: 50,
  msg: '日志脱敏失败',
  redactionError: true,
});
const JSON_WITH_RAW_JSON = JSON as typeof JSON & {
  rawJSON(source: string): unknown;
};
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-token"]',
  'req.headers["x-kt-media-agent-secret"]',
  'req.headers["x-kt-media-executor-secret"]',
  'req.headers["x-token"]',
  'body.accessToken',
  'body.adminToken',
  'body.authorization',
  'body.cookie',
  'body.refreshToken',
  'body.secret',
  'body.token',
  '*.clientSecret',
  '*.secret',
  '*.token',
];

/**
 * 根据`configService`构造针对日志管道；从 `getString` 读取针对日志管道。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @returns 包含 `pinoHttp` 字段的针对日志管道。
 */
export function createPinoLoggerParams(configService: ConfigService): Params {
  const nodeEnv = getString(configService, 'NODE_ENV', 'development');
  const appName = getAppName(configService);
  const lokiHost = normalizeUrl(
    getString(configService, 'LOKI_HOST') ||
      getString(configService, 'LOKI_URL'),
  );
  const logLevel = getString(
    configService,
    'LOG_LEVEL',
    (() => {
      if (nodeEnv === 'production') {
        return 'info';
      }
      return 'debug';
    })(),
  );

  return {
    pinoHttp: {
      autoLogging: false,
      base: {
        app: appName,
        env: nodeEnv,
      },
      customAttributeKeys: {
        responseTime: 'durationMs',
      },
      customProps: (req: Request) => ({
        meta: {
          requestId: getRequestId(req),
        },
      }),
      genReqId: (req: Request, res: Response) => {
        const requestId =
          getHeader(req, 'x-request-id') ||
          getHeader(req, 'x-correlation-id') ||
          randomUUID();
        res.setHeader('x-request-id', requestId);
        return requestId;
      },
      hooks: {
        streamWrite: redactSerializedPasswordFields,
      },
      level: logLevel,
      redact: {
        censor: '[Redacted]',
        paths: REDACT_PATHS,
      },
      transport: createTransport(configService, {
        appName,
        logLevel,
        lokiHost,
        nodeEnv,
      }),
    },
  };
}

/**
 * 对 Pino 已序列化记录按字段名递归脱敏密码并保留合法 JSON 行。
 * @param serialized - Pino 输出的单条 JSON 日志。
 * @returns 完成密码字段脱敏后的 JSON 日志。
 */
function redactSerializedPasswordFields(serialized: string): string {
  const lineEnding = (() => {
    if (serialized.endsWith('\r\n')) {
      return '\r\n';
    }
    if (serialized.endsWith('\n')) {
      return '\n';
    }
    return '';
  })();
  try {
    const record = JSON.parse(
      serialized,
      (_key, value, context?: { source?: string }) =>
        {
          if (typeof value === 'number' && context?.source) {
            return JSON_WITH_RAW_JSON.rawJSON(context.source);
          }
          return value;
        },
    );
    redactPasswordFields(record);
    return `${JSON.stringify(record)}${lineEnding}`;
  } catch {
    return `${REDACTION_FAILURE_RECORD}${lineEnding}`;
  }
}

/**
 * 递归替换对象和数组中的固定密码字段。
 * @param value - 已从日志 JSON 解析出的对象、数组或标量。
 */
function redactPasswordFields(value: unknown): void {
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }

    Object.entries(current).forEach(([key, nestedValue]) => {
      if (PASSWORD_FIELDS.has(key)) {
        (current as Record<string, unknown>)[key] = '[Redacted]';
      } else if (nestedValue && typeof nestedValue === 'object') {
        pending.push(nestedValue);
      }
    });
  }
}

/**
 * 按`configService`读取针对日志管道；从 `getString` 读取针对日志管道。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @returns 针对日志管道。
 */
export function getAppName(configService: ConfigService) {
  return getString(configService, 'LOG_APP_NAME', DEFAULT_APP_NAME);
}

/**
 * 按`configService`读取针对日志管道；从 `getString` 读取针对日志管道。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @returns 针对日志管道。
 */
export function getLokiEnvironment(configService: ConfigService) {
  return getString(
    configService,
    'LOKI_ENV',
    getString(configService, 'NODE_ENV', 'development'),
  );
}

/**
 * 根据`configService`、`options`构造针对日志管道；当 `options.lokiHost` 成立时返回 `{ targets: [ { level: options.logLevel, opt…`。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @param options - 控制针对日志管道筛选、缓存或输出方式的可选项，包含 `lokiHost`、`logLevel`、`appName`、`nodeEnv` 字段。
 * @returns 包含 `options`、`target` 字段的针对日志管道；没有可用结果或提前结束时为 `undefined`。
 */
function createTransport(
  configService: ConfigService,
  options: {
    appName: string;
    logLevel: string;
    lokiHost: string;
    nodeEnv: string;
  },
) {
  if (options.lokiHost) {
    return {
      targets: [
        {
          level: options.logLevel,
          options: {
            destination: 1,
          },
          target: 'pino/file',
        },
        {
          level: options.logLevel,
          options: {
            batching: {
              interval: getNumber(
                configService,
                'LOKI_BATCH_INTERVAL_SECONDS',
                5,
              ),
              maxBufferSize: getNumber(
                configService,
                'LOKI_BATCH_MAX_BUFFER_SIZE',
                10000,
              ),
            },
            basicAuth: getBasicAuth(configService),
            endpoint: getString(
              configService,
              'LOKI_PUSH_ENDPOINT',
              '/loki/api/v1/push',
            ),
            headers: getLokiHeaders(configService),
            host: options.lokiHost,
            labels: {
              app: options.appName,
              env: getLokiEnvironment(configService),
              service: 'api',
            },
            propsToLabels: ['context'],
            silenceErrors: getBoolean(
              configService,
              'LOKI_SILENCE_ERRORS',
              true,
            ),
            timeout: getNumber(configService, 'LOKI_PUSH_TIMEOUT_MS', 30000),
          },
          target: 'pino-loki',
        },
      ],
    };
  }

  if (
    options.nodeEnv !== 'production' &&
    getBoolean(configService, 'LOG_PRETTY', true)
  ) {
    return {
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        singleLine: false,
        translateTime: 'SYS:standard',
      },
      target: 'pino-pretty',
    };
  }

  return undefined;
}

/**
 * 按`configService`读取针对日志管道；当 `tenantId` 成立时返回 `{ 'X-Scope-OrgID': tenantId, }`。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @returns 包含 `X-Scope-OrgID` 字段的针对日志管道；没有可用结果或提前结束时为 `undefined`。
 */
function getLokiHeaders(configService: ConfigService) {
  const tenantId = getString(configService, 'LOKI_TENANT_ID');
  if (tenantId) {
    return {
        'X-Scope-OrgID': tenantId,
      };
  }
  return undefined;
}

/**
 * 按`configService`读取针对日志管道；当 `username && password` 成立时返回 `{ password, username }`。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @returns 包含 `password`、`username` 字段的针对日志管道；没有可用结果或提前结束时为 `undefined`。
 */
function getBasicAuth(configService: ConfigService) {
  const username = getString(configService, 'LOKI_USERNAME');
  const password = getString(configService, 'LOKI_PASSWORD');
  if (username && password) {
    return { password, username };
  }
  return undefined;
}

/**
 * 按`req`、`name`读取针对日志管道；当 `Array.isArray(value)` 成立时返回 `value[0]`。
 * @param req - 用于针对日志管道的当前 HTTP 请求，包含 `headers` 字段。
 * @param name - 决定针对日志管道内容、边界或目标的 `name` 值。
 * @returns 针对日志管道。
 */
function getHeader(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return `${value || ''}`.trim();
}

/**
 * 按`req`读取针对日志管道；从 `getHeader` 读取针对日志管道。
 * @param req - 用于针对日志管道的当前 HTTP 请求。
 * @returns 针对日志管道。
 */
function getRequestId(req: Request) {
  return `${(req as any).id || getHeader(req, 'x-request-id') || ''}`.trim();
}

/**
 * 按`configService`、`key`、`fallback`读取针对日志管道；从 `configService.get` 读取针对日志管道。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @param key - 用于读取或更新针对日志管道的稳定键。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
 * @returns 规范化后的针对日志管道；主值为空时采用 `fallback` 兜底。
 */
function getString(configService: ConfigService, key: string, fallback = '') {
  const value = configService.get<string>(key);
  const normalized = `${value ?? ''}`.trim();
  return normalized || fallback;
}

/**
 * 读取正数配置；值不是有限正数时返回调用方提供的默认值。
 * @param configService - 读取正数配置所需运行配置的配置服务。
 * @param key - 用于读取或更新正数配置的稳定键。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 返回有效的正数配置；缺失或非法时返回 `defaultValue`。
 */
function getNumber(
  configService: ConfigService,
  key: string,
  fallback: number,
) {
  const value = Number(configService.get<string>(key));
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

/**
 * 按`configService`、`key`、`fallback`读取针对日志管道；从 `configService.get` 读取针对日志管道。
 * @param configService - 读取针对日志管道所需运行配置的配置服务。
 * @param key - 用于读取或更新针对日志管道的稳定键。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 满足针对日志管道约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function getBoolean(
  configService: ConfigService,
  key: string,
  fallback: boolean,
) {
  const value = configService.get<string>(key);
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
}

/**
 * 将`value`规范为针对日志管道，使等价输入得到一致表示。
 * @param value - 待转换为针对日志管道的原始值。
 * @returns 针对日志管道。
 */
function normalizeUrl(value: string) {
  return value.replace(/\/+$/g, '');
}
