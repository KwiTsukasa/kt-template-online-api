import { RepeaterApplication } from './application/repeater-application';
import type { RepeaterManifest } from './domain/repeater.types';
import { createRepeaterMessageEventHandler } from './events/message';
import type { RepeaterPluginHost } from './infrastructure/integration/repeater-host';

type RepeaterPluginOptions = {
  host: RepeaterPluginHost;
  manifest: RepeaterManifest;
  now?: () => number;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: RepeaterManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type RepeaterPluginCreateOptions =
  | RepeaterPluginOptions
  | QqbotGenericPluginCreateOptions;

/**
 * Creates the Repeater plugin entry for package-local calls or the generic worker runtime.
 * @param options - Legacy package-local options or generic worker options with config snapshot and host RPC facade.
 * @returns Repeater event plugin instance.
 */
export function createPlugin(options: RepeaterPluginCreateOptions) {
  if (isRepeaterGenericPluginCreateOptions(options)) {
    return buildRepeaterPlugin({
      host: createRepeaterGenericHostAdapter(options),
      manifest: normalizeRepeaterManifest(options.manifest),
      now: () => options.now().getTime(),
    });
  }
  return buildRepeaterPlugin(options);
}

/**
 * Creates the Repeater plugin from the package-local host contract.
 * @param options - Package-local host, manifest, and millisecond clock used by repeat policy state.
 * @returns Repeater event plugin used by package-local callers, tests, and generic workers.
 */
function buildRepeaterPlugin(options: RepeaterPluginOptions) {
  const application = new RepeaterApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createRepeaterMessageEventHandler(application);

  return {
    /**
     * 维护 模块事件绑定。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    bind: (selfId: string) => application.bind(selfId),
    /**
     * 执行 模块回调。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    clearBoundCache: (selfId: string) => application.clearBoundCache(selfId),
    /**
     * 读取 模块回调数据。
     */
    getDefinition: () => application.getDefinition(),
    /**
     * 读取 模块回调数据。
     * @param params - 模块列表；驱动 `application.getSummary()` 的 模块步骤。
     */
    getSummary: (params: {
      accountName?: string;
      connectStatus?: string;
      selfId: string;
    }) => application.getSummary(params),
    /**
     * Routes generic worker event calls to the package-owned Repeater message handler.
     * @param eventKey - Manifest event key or event name supplied by the generic worker.
     * @param event - Normalized QQBot message event payload.
     */
    handleEvent: (eventKey: string, event: unknown) =>
      handleRepeaterGenericEvent(
        eventKey,
        event,
        options.manifest,
        handleMessage,
      ),
    handleMessage,
    /**
     * 维护 模块事件绑定。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    unbind: (selfId: string) => application.unbind(selfId),
  };
}

/**
 * Checks whether Repeater create options came from the generic worker runtime.
 * @param options - Candidate create options supplied by the plugin loader.
 * @returns `true` when a runtime config snapshot is present.
 */
function isRepeaterGenericPluginCreateOptions(
  options: RepeaterPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * Normalizes generic manifest aliases so Repeater keeps a package-local plugin key.
 * @param manifest - Manifest supplied by the generic worker descriptor.
 * @returns Manifest with `pluginKey` filled from `key` when needed.
 */
function normalizeRepeaterManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): RepeaterManifest {
  return {
    ...manifest,
    events: manifest.events || [],
    pluginKey: manifest.pluginKey || manifest.key || 'repeater',
  };
}

/**
 * Builds the Repeater application host over generic worker host methods.
 * @param options - Generic worker context containing host RPC methods and config snapshot.
 * @returns Package-local host expected by `RepeaterApplication`.
 */
function createRepeaterGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): RepeaterPluginHost {
  const { host, runtime } = options;
  return {
    /**
     * Binds this Repeater package to one account through the generic host bridge.
     * @param selfId - QQBot self account id whose event binding is being enabled.
     * @param pluginKey - Package plugin key; parent bridge still uses its authoritative descriptor key.
     */
    bindEventPlugin: async (selfId, pluginKey) => {
      await callRepeaterGenericHost(host, 'bindEventPlugin', selfId, pluginKey);
    },
    /**
     * Reads currently bound event plugin keys for one QQBot account.
     * @param selfId - QQBot self account id whose event plugin bindings are being queried.
     * @returns Bound plugin keys returned by the host account service.
     */
    getBoundEventPluginKeys: async (selfId) =>
      await callRepeaterGenericHost(host, 'getBoundEventPluginKeys', selfId),
    /**
     * Reads Repeater config synchronously from the worker startup snapshot.
     * @param key - Runtime config key declared by the Repeater package manifest.
     * @returns Snapshot value cast to the requested config type.
     */
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    /**
     * Sends text through the QQBot host send queue.
     * @param input - Target account, conversation, and message text produced by the repeat policy.
     * @returns Host send result for observability.
     */
    sendText: async (input) =>
      await callRepeaterGenericHost(host, 'sendText', input),
    /**
     * Unbinds this Repeater package from one account through the generic host bridge.
     * @param selfId - QQBot self account id whose event binding is being disabled.
     * @param pluginKey - Package plugin key; parent bridge still uses its authoritative descriptor key.
     */
    unbindEventPlugin: async (selfId, pluginKey) => {
      await callRepeaterGenericHost(
        host,
        'unbindEventPlugin',
        selfId,
        pluginKey,
      );
    },
    /**
     * Emits a package warning through the generic host bridge without blocking message handling.
     * @param message - Repeater warning text to write into host logs.
     */
    warn: (message) => {
      void callRepeaterGenericHost(host, 'warn', message).catch(
        () => undefined,
      );
    },
  };
}

/**
 * Routes a generic worker event to the Repeater message handler when it matches the manifest event.
 * @param eventKey - Manifest event key, event name, or handler name supplied by the generic worker.
 * @param event - Normalized QQBot event payload forwarded by the platform.
 * @param manifest - Repeater manifest containing package-owned event metadata.
 * @param handleMessage - Package-local message handler produced by `createRepeaterMessageEventHandler`.
 * @returns Repeater message handling result or `false` for unrelated events.
 */
async function handleRepeaterGenericEvent(
  eventKey: string,
  event: unknown,
  manifest: RepeaterManifest,
  handleMessage: (message: any) => Promise<boolean>,
) {
  const matched = (manifest.events || []).some((item: any) =>
    [item.key, item.eventName, item.handlerName].includes(eventKey),
  );
  if (!matched && eventKey !== 'message') return false;
  return handleMessage(event as any);
}

/**
 * Calls one Repeater generic host method and fails with a package-owned error when absent.
 * @param host - Generic worker host facade supplied by the platform runtime.
 * @param method - Host capability required by the Repeater adapter.
 * @param args - Positional arguments accepted by the host facade method.
 * @returns Host method result cast to the requested package-local type.
 */
async function callRepeaterGenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`Repeater generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}
