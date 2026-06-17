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

/**
 * Creates the FF14 Market plugin entry for package-local calls or the generic worker runtime.
 * @param options - Legacy package-local options or generic worker options with config snapshot and host RPC facade.
 * @returns FF14 Market command plugin instance.
 */
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

/**
 * Creates the FF14 Market plugin from the package-local host contract.
 * @param options - Package-local host, manifest, clock, and error normalizer.
 * @returns FF14 Market command plugin used by package-local callers and tests.
 */
function buildFf14MarketPlugin(options: Ff14MarketPluginOptions) {
  const application = new Ff14MarketApplication(
    new Ff14MarketClient(options.host),
  );

  return {
    description: options.manifest.description,
    /**
     * 执行 FF14 市场回调。
     */
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

/**
 * Checks whether FF14 Market create options came from the generic worker runtime.
 * @param options - Candidate create options supplied by the plugin loader.
 * @returns `true` when a runtime config snapshot is present.
 */
function isFf14GenericPluginCreateOptions(
  options: Ff14MarketPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * Normalizes generic manifest aliases so FF14 Market keeps a package-local plugin key.
 * @param manifest - Manifest supplied by the generic worker descriptor.
 * @returns Manifest with `pluginKey` filled from `key` when needed.
 */
function normalizeFf14MarketManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): Ff14MarketManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'ff14-market',
  };
}

/**
 * Builds the FF14 Market client host over generic worker host methods.
 * @param options - Generic worker context containing host RPC methods and config snapshot.
 * @returns Package-local host expected by `Ff14MarketClient`.
 */
function createFf14MarketGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): Ff14MarketPluginHost {
  const { host, runtime } = options;
  return {
    /**
     * Reads FF14 Market config synchronously from the worker startup snapshot.
     * @param key - Runtime config key declared by the FF14 Market package manifest.
     * @returns Snapshot value cast to the requested config type.
     */
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    /**
     * Reads dictionary items through the generic host bridge.
     * @param dictCode - FF14 dictionary code used for region, data center, or world lookup.
     * @returns Dictionary items returned by the host dictionary service.
     */
    getDictItemsByKey: async (dictCode) =>
      await callFf14GenericHost(host, 'getDictItemsByKey', dictCode),
    /**
     * Reads the FF14 dictionary relation tree through the generic host bridge.
     * @param input - Relation tree root dictionary code requested by the FF14 catalog builder.
     * @returns Relation tree nodes returned by the host dictionary service.
     */
    relationTree: async (input) =>
      await callFf14GenericHost(host, 'relationTree', input),
    /**
     * Performs FF14 Market HTTP JSON requests through the generic host bridge.
     * @param request - Package-local HTTP request options from `Ff14MarketClient`.
     * @returns Parsed JSON payload returned by the host HTTP client.
     */
    requestJson: async <T>(request) =>
      await callFf14GenericHost<T>(
        host,
        'requestJson',
        serializeFf14GenericHttpRequest(request),
      ),
  };
}

/**
 * Calls one FF14 Market generic host method and fails with a package-owned error when absent.
 * @param host - Generic worker host facade supplied by the platform runtime.
 * @param method - Host capability required by the FF14 Market adapter.
 * @param args - Positional arguments accepted by the host facade method.
 * @returns Host method result cast to the requested package-local type.
 */
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

/**
 * Converts package-local HTTP options to worker-safe generic host request data.
 * @param request - FF14 Market HTTP request containing URL and function-based failure message.
 * @returns Serializable request data accepted by the generic host bridge.
 */
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

/**
 * Normalizes generic worker errors to the legacy FF14 Market string error contract.
 * @param normalizeError - Generic worker error normalizer supplied by the platform runtime.
 * @param error - Error or arbitrary thrown value from package code.
 * @param fallback - FF14 Market fallback message used by health checks.
 * @returns String message consumed by legacy plugin health output.
 */
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
  /**
   * 补齐 FF14 市场插件展示文本。
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
