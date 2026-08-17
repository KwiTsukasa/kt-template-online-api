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

/** 创建插件。 */
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

/** 构建复读器插件。 */
function buildRepeaterPlugin(options: RepeaterPluginOptions) {
  const application = new RepeaterApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createRepeaterMessageEventHandler(application);

  return {
    bind: (selfId: string) => application.bind(selfId),
    clearBoundCache: (selfId: string) => application.clearBoundCache(selfId),
    getDefinition: () => application.getDefinition(),
    getSummary: (params: {
      accountName?: string;
      connectStatus?: string;
      selfId: string;
    }) => application.getSummary(params),
    handleEvent: (eventKey: string, event: unknown) =>
      handleRepeaterGenericEvent(
        eventKey,
        event,
        options.manifest,
        handleMessage,
      ),
    handleMessage,
    unbind: (selfId: string) => application.unbind(selfId),
  };
}

/** 判断复读器通用插件创建选项是否成立。 */
function isRepeaterGenericPluginCreateOptions(
  options: RepeaterPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/** 规范化复读器清单。 */
function normalizeRepeaterManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): RepeaterManifest {
  return {
    ...manifest,
    events: manifest.events || [],
    pluginKey: manifest.pluginKey || manifest.key || 'repeater',
  };
}

/** 创建复读器通用主机适配器。 */
function createRepeaterGenericHostAdapter(
  options: QqbotGenericPluginCreateOptions,
): RepeaterPluginHost {
  const { host, runtime } = options;
  return {
    bindEventPlugin: async (selfId, pluginKey) => {
      await callRepeaterGenericHost(host, 'bindEventPlugin', selfId, pluginKey);
    },
    getBoundEventPluginKeys: async (selfId) =>
      await callRepeaterGenericHost(host, 'getBoundEventPluginKeys', selfId),
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    sendText: async (input) =>
      await callRepeaterGenericHost(host, 'sendText', input),
    unbindEventPlugin: async (selfId, pluginKey) => {
      await callRepeaterGenericHost(
        host,
        'unbindEventPlugin',
        selfId,
        pluginKey,
      );
    },
    warn: (message) => {
      void callRepeaterGenericHost(host, 'warn', message).catch(
        () => undefined,
      );
    },
  };
}

/** 处理复读器通用事件。 */
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

/** 返回调用复读器通用主机。 */
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
