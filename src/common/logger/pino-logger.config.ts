import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { ConfigService } from '@nestjs/config';

const DEFAULT_APP_NAME = 'kt-template-online-api';
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-token"]',
  'req.headers["x-token"]',
  'body.accessToken',
  'body.adminToken',
  'body.authorization',
  'body.cookie',
  'body.password',
  'body.refreshToken',
  'body.secret',
  'body.token',
  '*.clientSecret',
  '*.password',
  '*.secret',
  '*.token',
];

export function createPinoLoggerParams(
  configService: ConfigService,
): Params {
  const nodeEnv = getString(configService, 'NODE_ENV', 'development');
  const appName = getAppName(configService);
  const lokiHost = normalizeUrl(
    getString(configService, 'LOKI_HOST') || getString(configService, 'LOKI_URL'),
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

export function getAppName(configService: ConfigService) {
  return getString(configService, 'LOG_APP_NAME', DEFAULT_APP_NAME);
}

export function getLokiEnvironment(configService: ConfigService) {
  return getString(configService, 'LOKI_ENV', getString(configService, 'NODE_ENV', 'development'));
}

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
            silenceErrors: getBoolean(configService, 'LOKI_SILENCE_ERRORS', true),
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

function getLokiHeaders(configService: ConfigService) {
  const tenantId = getString(configService, 'LOKI_TENANT_ID');
  return tenantId
    ? {
        'X-Scope-OrgID': tenantId,
      }
    : undefined;
}

function getBasicAuth(configService: ConfigService) {
  const username = getString(configService, 'LOKI_USERNAME');
  const password = getString(configService, 'LOKI_PASSWORD');
  return username && password ? { password, username } : undefined;
}

function getHeader(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : `${value || ''}`.trim();
}

function getRequestId(req: Request) {
  return `${(req as any).id || getHeader(req, 'x-request-id') || ''}`.trim();
}

function getString(
  configService: ConfigService,
  key: string,
  fallback = '',
) {
  const value = configService.get<string>(key);
  const normalized = `${value ?? ''}`.trim();
  return normalized || fallback;
}

function getNumber(
  configService: ConfigService,
  key: string,
  fallback: number,
) {
  const value = Number(configService.get<string>(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getBoolean(
  configService: ConfigService,
  key: string,
  fallback: boolean,
) {
  const value = configService.get<string>(key);
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/g, '');
}
