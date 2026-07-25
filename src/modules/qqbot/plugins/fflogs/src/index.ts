import { FflogsApplication } from './application/fflogs-application';
import {
  FflogsClient,
  type FflogsPluginHost,
} from './infrastructure/integration/fflogs-client';
import { buildFflogsOperations, type FflogsManifest } from './operations';

type FflogsPluginOptions = {
  host: import('./infrastructure/integration/fflogs-client').FflogsPluginHost;
  manifest: FflogsManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: FflogsManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type FflogsPluginCreateOptions =
  | FflogsPluginOptions
  | QqbotGenericPluginCreateOptions;

export function createPlugin(options: FflogsPluginCreateOptions) {
  if (isFflogsGenericPluginCreateOptions(options)) {
    return buildFflogsPlugin({
      host: createFflogsGenericHostAdapter(options),
      manifest: normalizeFflogsManifest(options.manifest),
      normalizeError: (error, fallback) =>
        normalizeFflogsGenericError(options.normalizeError, error, fallback),
      now: options.now,
    });
  }
  return buildFflogsPlugin(options);
}

function buildFflogsPlugin(options: FflogsPluginOptions) {
  const application = new FflogsApplication(new FflogsClient(options.host));
  return {
    description: options.manifest.description,
    healthCheck: async () => {
      const checkedAt = formatFflogsCheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FFLogs 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FFLogs 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFflogsOperations(application, options.manifest.operations),
    version: options.manifest.version,
  };
}

function isFflogsGenericPluginCreateOptions(
  options: FflogsPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

function normalizeFflogsManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): FflogsManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'fflogs',
  };
}

function createFflogsGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): FflogsPluginHost {
  const { host, runtime } = options;
  return {
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    getDictByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    getDictItemsByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    relationTree: async (input) =>
      await callFflogsGenericHost(host, 'relationTree', input),
    requestJson: async <T>(request) =>
      await callFflogsGenericHost<T>(
        host,
        'requestJson',
        serializeFflogsGenericHttpRequest(request),
      ),
  };
}

async function callFflogsGenericDictHost(
  host: Record<string, unknown>,
  dictCode: string,
) {
  const method =
    typeof host.getDictItemsByKey === 'function'
      ? 'getDictItemsByKey'
      : 'getDictByKey';
  return await callFflogsGenericHost(host, method, dictCode);
}

async function callFflogsGenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`FFLogs generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

function serializeFflogsGenericHttpRequest(
  request: Parameters<FflogsPluginHost['requestJson']>[0],
) {
  const statusPlaceholder = 599;
  return {
    body: request.body,
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    headers: request.headers,
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}

function normalizeFflogsGenericError(
  normalizeError: QqbotGenericPluginCreateOptions['normalizeError'],
  error: unknown,
  fallback: string,
) {
  const normalized = normalizeError(error, fallback);
  return normalized instanceof Error ? normalized.message : `${normalized}`;
}

/**
 * 转换 FFLogs 插件输入。
 * @param date - date 输入；执行 `date.getFullYear()`、`date.getMonth()`、`date.getDate()`、`date.getHours()` 对应的 FFLogs步骤。
 */
function formatFflogsCheckedAt(date: Date) {
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
