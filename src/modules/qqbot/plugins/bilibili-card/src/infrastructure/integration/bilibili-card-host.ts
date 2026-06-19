import type {
  BilibiliCardHostJsonRequest,
  BilibiliCardPluginHost,
} from '../../domain/bilibili-card.types';

export type BilibiliCardGenericHost = Record<string, unknown>;

/**
 * Creates the package-local host adapter over the generic worker host facade.
 * @param host - Generic worker host object supplied by the plugin platform runtime.
 * @param configSnapshot - Startup config values captured by the worker runtime.
 * @returns Package-local host contract used by Bilibili card domain and integration code.
 */
export function createBilibiliCardGenericHostAdapter(
  host: BilibiliCardGenericHost,
  configSnapshot: Record<string, string | undefined>,
): BilibiliCardPluginHost {
  return {
    /**
     * Reads event plugin bindings through the generic host bridge.
     * @param selfId - QQBot account id from a normalized message event.
     * @returns Bound event plugin keys for the account.
     */
    getBoundEventPluginKeys: async (selfId) =>
      await callBilibiliCardGenericHost(host, 'getBoundEventPluginKeys', selfId),
    /**
     * Reads Bilibili card config from the worker startup snapshot.
     * @param key - Runtime config key declared by the Bilibili card manifest.
     * @returns Snapshot value cast to the requested config type.
     */
    getConfig: <T = string>(key: string) =>
      configSnapshot[key] as T | undefined,
    /**
     * Performs JSON HTTP requests through the generic host bridge.
     * @param request - Package-local HTTP request options from `BilibiliVideoClient`.
     * @returns Parsed JSON payload returned by the host HTTP client.
     */
    requestJson: async <T = unknown>(request) =>
      await callBilibiliCardGenericHost<T>(
        host,
        'requestJson',
        serializeBilibiliCardJsonRequest(request),
      ),
    /**
     * Resolves short-link redirects through the generic host bridge.
     * @param request - Redirect request containing URL, timeout and max redirect budget.
     * @returns Final URL and redirect chain returned by the host HTTP client.
     */
    resolveRedirect: async (request) =>
      await callBilibiliCardGenericHost(host, 'resolveRedirect', request),
    /**
     * Sends a plain text QQBot reply through the generic host bridge.
     * @param input - Target conversation and message text produced by the plugin.
     * @returns Host send result.
     */
    sendText: async (input) =>
      await callBilibiliCardGenericHost(host, 'sendText', input),
    /**
     * Emits a package warning through the generic host when available.
     * @param message - Warning message safe for platform logs.
     */
    warn: (message) => {
      const warn = host.warn;
      if (typeof warn === 'function') warn(message);
    },
  };
}

/**
 * Calls one generic host method and fails with a package-owned error when absent.
 * @param host - Generic worker host facade supplied by the platform runtime.
 * @param method - Host capability required by the Bilibili card adapter.
 * @param args - Positional arguments accepted by the host facade method.
 * @returns Host method result cast to the requested package-local type.
 */
export async function callBilibiliCardGenericHost<TResult = unknown>(
  host: BilibiliCardGenericHost,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`Bilibili Card generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

/**
 * Converts package-local JSON request options to worker-safe generic host request data.
 * @param request - HTTP request containing URL and function-based failure message.
 * @returns Serializable request data accepted by the generic host bridge.
 */
export function serializeBilibiliCardJsonRequest(
  request: BilibiliCardHostJsonRequest,
) {
  const statusPlaceholder = 599;
  return {
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}
