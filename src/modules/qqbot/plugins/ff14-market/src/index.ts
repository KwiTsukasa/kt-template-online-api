import { Ff14MarketApplication } from './application/ff14-market-application';
import {
  Ff14MarketClient,
  type Ff14MarketPluginHost,
} from './infrastructure/integration/ff14-market-client';
import {
  buildFf14MarketOperations,
  type Ff14MarketManifest,
} from './operations';

type Ff14MarketPluginOptions = {
  host: import('./infrastructure/integration/ff14-market-client').Ff14MarketPluginHost;
  manifest: Ff14MarketManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: Ff14MarketManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type Ff14MarketPluginCreateOptions =
  | Ff14MarketPluginOptions
  | QqbotGenericPluginCreateOptions;

/** 创建插件。 */
export function createPlugin(options: Ff14MarketPluginCreateOptions) {
  if (isFf14GenericPluginCreateOptions(options)) {
    return buildFf14MarketPlugin({
      host: createFf14MarketGenericHostAdapter(options),
      manifest: normalizeFf14MarketManifest(options.manifest),
      normalizeError: (error, fallback) =>
        normalizeFf14MarketGenericError(
          options.normalizeError,
          error,
          fallback,
        ),
      now: options.now,
    });
  }
  return buildFf14MarketPlugin(options);
}

/** 构建FF14市场插件。 */
function buildFf14MarketPlugin(options: Ff14MarketPluginOptions) {
  const application = new Ff14MarketApplication(
    new Ff14MarketClient(options.host),
  );

  return {
    description: options.manifest.description,
    healthCheck: async () => {
      const checkedAt = formatFf14CheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FF14 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FF14 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFf14MarketOperations(
      application,
      options.manifest.operations,
    ),
    version: options.manifest.version,
  };
}

/** 判断FF14通用插件创建选项是否成立。 */
function isFf14GenericPluginCreateOptions(
  options: Ff14MarketPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/** 规范化FF14市场清单。 */
function normalizeFf14MarketManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): Ff14MarketManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'ff14-market',
  };
}

/** 创建FF14市场通用主机适配器。 */
function createFf14MarketGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): Ff14MarketPluginHost {
  const { host, runtime } = options;
  return {
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    getDictItemsByKey: async (dictCode) =>
      await callFf14GenericHost(host, 'getDictItemsByKey', dictCode),
    relationTree: async (input) =>
      await callFf14GenericHost(host, 'relationTree', input),
    requestJson: async <T>(request) =>
      await callFf14GenericHost<T>(
        host,
        'requestJson',
        serializeFf14GenericHttpRequest(request),
      ),
  };
}

/** 返回调用FF14通用主机。 */
async function callFf14GenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`FF14 Market generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

/** 序列化FF14通用HTTP请求。 */
function serializeFf14GenericHttpRequest(
  request: Parameters<Ff14MarketPluginHost['requestJson']>[0],
) {
  const statusPlaceholder = 599;
  return {
    body: undefined,
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    headers: undefined,
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}

/** 规范化FF14市场通用错误。 */
function normalizeFf14MarketGenericError(
  normalizeError: QqbotGenericPluginCreateOptions['normalizeError'],
  error: unknown,
  fallback: string,
) {
  const normalized = normalizeError(error, fallback);
  return normalized instanceof Error ? normalized.message : `${normalized}`;
}

/**
 * 转换 FF14 市场插件输入。
 * @param date - date 输入；执行 `date.getFullYear()`、`date.getMonth()`、`date.getDate()`、`date.getHours()` 对应的 FF14 市场步骤。
 */
function formatFf14CheckedAt(date: Date) {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}
