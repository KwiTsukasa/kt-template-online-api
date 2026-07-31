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
 * 创建 日志管道对象或配置。
 * @param configService - Nest ConfigService 依赖；驱动 `getString()`、`getAppName()`、`normalizeUrl()`、`createTransport()` 的 公共基础设施步骤。
 * @returns 创建后的 日志管道对象或配置。
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
    nodeEnv === 'production' ? 'info' : 'debug',
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
  const lineEnding = serialized.endsWith('\r\n')
    ? '\r\n'
    : serialized.endsWith('\n')
      ? '\n'
      : '';
  try {
    const record = JSON.parse(
      serialized,
      (_key, value, context?: { source?: string }) =>
        typeof value === 'number' && context?.source
          ? JSON_WITH_RAW_JSON.rawJSON(context.source)
          : value,
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
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；驱动 `getString()` 的 公共基础设施步骤。
 */
export function getAppName(configService: ConfigService) {
  return getString(configService, 'LOG_APP_NAME', DEFAULT_APP_NAME);
}

/**
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；驱动 `getString()` 的 公共基础设施步骤。
 */
export function getLokiEnvironment(configService: ConfigService) {
  return getString(
    configService,
    'LOKI_ENV',
    getString(configService, 'NODE_ENV', 'development'),
  );
}

/**
 * 创建 日志管道对象或配置。
 * @param configService - Nest ConfigService 依赖；驱动 `getNumber()`、`getBasicAuth()`、`getLokiEnvironment()`、`getBoolean()` 的 公共基础设施步骤。
 * @param options - 公共基础设施列表；使用 `lokiHost`、`logLevel`、`appName`、`nodeEnv` 字段生成结果。
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
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；驱动 `getString()` 的 公共基础设施步骤。
 */
function getLokiHeaders(configService: ConfigService) {
  const tenantId = getString(configService, 'LOKI_TENANT_ID');
  return tenantId
    ? {
        'X-Scope-OrgID': tenantId,
      }
    : undefined;
}

/**
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；驱动 `getString()` 的 公共基础设施步骤。
 */
function getBasicAuth(configService: ConfigService) {
  const username = getString(configService, 'LOKI_USERNAME');
  const password = getString(configService, 'LOKI_PASSWORD');
  return username && password ? { password, username } : undefined;
}

/**
 * 查询 日志管道数据。
 * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
 * @param name - 名称文本；执行 `name.toLowerCase()` 对应的 公共基础设施步骤。
 */
function getHeader(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : `${value || ''}`.trim();
}

/**
 * 查询 日志管道数据。
 * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
 */
function getRequestId(req: Request) {
  return `${(req as any).id || getHeader(req, 'x-request-id') || ''}`.trim();
}

/**
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；使用 `get` 字段生成结果。
 * @param key - 键名；限定 公共基础设施查询范围。
 * @param fallback - 兜底值；限定 公共基础设施查询范围。
 */
function getString(configService: ConfigService, key: string, fallback = '') {
  const value = configService.get<string>(key);
  const normalized = `${value ?? ''}`.trim();
  return normalized || fallback;
}

/**
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；使用 `get` 字段生成结果。
 * @param key - 键名；驱动 `Number()` 的 公共基础设施步骤。
 * @param fallback - 兜底值；驱动 `Number.isFinite()` 的 公共基础设施步骤。
 */
function getNumber(
  configService: ConfigService,
  key: string,
  fallback: number,
) {
  const value = Number(configService.get<string>(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 查询 日志管道数据。
 * @param configService - Nest ConfigService 依赖；使用 `get` 字段生成结果。
 * @param key - 键名；限定 公共基础设施查询范围。
 * @param fallback - 兜底值；限定 公共基础设施查询范围。
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
 * 转换 日志管道输入。
 * @param value - 待转换值；生成规范化文本。
 */
function normalizeUrl(value: string) {
  return value.replace(/\/+$/g, '');
}
