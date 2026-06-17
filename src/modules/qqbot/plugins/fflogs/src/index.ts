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

/**
 * Creates the FFLogs plugin entry for package-local calls or the generic worker runtime.
 * @param options - Legacy package-local options or generic worker options with config snapshot and host RPC facade.
 * @returns FFLogs command plugin instance.
 */
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

/**
 * Creates the FFLogs plugin from the package-local host contract.
 * @param options - Package-local host, manifest, clock, and error normalizer.
 * @returns FFLogs command plugin used by package-local callers and tests.
 */
function buildFflogsPlugin(options: FflogsPluginOptions) {
  const application = new FflogsApplication(new FflogsClient(options.host));
  return {
    description: options.manifest.description,
    /**
     * 执行 FFLogs回调。
     */
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

/**
 * Checks whether FFLogs create options came from the generic worker runtime.
 * @param options - Candidate create options supplied by the plugin loader.
 * @returns `true` when a runtime config snapshot is present.
 */
function isFflogsGenericPluginCreateOptions(
  options: FflogsPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * Normalizes generic manifest aliases so FFLogs keeps a package-local plugin key.
 * @param manifest - Manifest supplied by the generic worker descriptor.
 * @returns Manifest with `pluginKey` filled from `key` when needed.
 */
function normalizeFflogsManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): FflogsManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'fflogs',
  };
}

/**
 * Builds the FFLogs client host over generic worker host methods.
 * @param options - Generic worker context containing host RPC methods and config snapshot.
 * @returns Package-local host expected by `FflogsClient`.
 */
function createFflogsGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): FflogsPluginHost {
  const { host, runtime } = options;
  return {
    /**
     * Reads FFLogs config synchronously from the worker startup snapshot.
     * @param key - Runtime config key declared by the FFLogs package manifest.
     * @returns Snapshot value cast to the requested config type.
     */
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    /**
     * Reads dictionary items through the legacy dictionary method name when FFLogs localization asks for it.
     * @param dictCode - Dictionary code used by FFLogs localization or FF14 world lookup.
     * @returns Dictionary items returned by the host dictionary service.
     */
    getDictByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    /**
     * Reads dictionary items through the generic dictionary method name for package-owned FF14 world lookup.
     * @param dictCode - Dictionary code used by FFLogs known-world resolution.
     * @returns Dictionary items returned by the host dictionary service.
     */
    getDictItemsByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    /**
     * Reads the FF14 dictionary relation tree through the generic host bridge.
     * @param input - Relation tree root dictionary code requested by FFLogs known-world resolution.
     * @returns Relation tree nodes returned by the host dictionary service.
     */
    relationTree: async (input) =>
      await callFflogsGenericHost(host, 'relationTree', input),
    /**
     * Performs FFLogs HTTP JSON requests through the generic host bridge.
     * @param request - Package-local HTTP request options from `FflogsClient`.
     * @returns Parsed JSON payload returned by the host HTTP client.
     */
    requestJson: async <T>(request) =>
      await callFflogsGenericHost<T>(
        host,
        'requestJson',
        serializeFflogsGenericHttpRequest(request),
      ),
  };
}

/**
 * Reads dictionary items through the preferred generic host method with a legacy name fallback.
 * @param host - Generic worker host facade supplied by the platform runtime.
 * @param dictCode - Dictionary code requested by FFLogs package code.
 * @returns Dictionary items returned by the host bridge.
 */
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

/**
 * Calls one FFLogs generic host method and fails with a package-owned error when absent.
 * @param host - Generic worker host facade supplied by the platform runtime.
 * @param method - Host capability required by the FFLogs adapter.
 * @param args - Positional arguments accepted by the host facade method.
 * @returns Host method result cast to the requested package-local type.
 */
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

/**
 * Converts package-local HTTP options to worker-safe generic host request data.
 * @param request - FFLogs HTTP request containing URL and function-based failure message.
 * @returns Serializable request data accepted by the generic host bridge.
 */
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

/**
 * Normalizes generic worker errors to the legacy FFLogs string error contract.
 * @param normalizeError - Generic worker error normalizer supplied by the platform runtime.
 * @param error - Error or arbitrary thrown value from package code.
 * @param fallback - FFLogs fallback message used by health checks.
 * @returns String message consumed by legacy plugin health output.
 */
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
  /**
   * 补齐 FFLogs 插件展示文本。
   * @param input - input 输入；影响 pad 的返回值。
   */
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
