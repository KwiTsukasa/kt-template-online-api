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
 * 根据`options`构造插件；当 `isRepeaterGenericPluginCreateOptions(options)` 成立时返回 `buildRepeaterPlugin({ host: createRepeaterG…`。
 * @param options - 控制插件筛选、缓存或输出方式的可选项，包含 `manifest`、`now` 字段。
 * @returns 返回按运行时选项构建的插件实例。
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
 * 根据`options`构造复读器插件。
 * @param options - 控制复读器插件筛选、缓存或输出方式的可选项，包含 `host`、`manifest`、`now` 字段。
 * @returns 包含 `bind`、`clearBoundCache`、`getDefinition`、`getSummary`、`handleEvent` 字段的复读器插件。
 */
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

/**
 * 根据`options`与当前约束判定复读器通用插件创建选项。
 * @param options - 控制复读器通用插件创建选项筛选、缓存或输出方式的可选项。
 * @returns 满足复读器通用插件创建选项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 规范化复读器清单，并输出固定投影 `events`、`pluginKey` 字段。
 * @param manifest - 用于Repeater清单的领域对象，包含 `events`、`pluginKey`、`key` 字段。
 * @returns 包含 `events`、`pluginKey` 字段的Repeater清单。
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
 * 创建复读器通用主机适配器，并输出固定投影 `bindEventPlugin`、`getBoundEventPluginKeys`、`getConfig`、`sendText`、`unbindEventPlugin` 字段。
 * @param options - 控制Repeater宿主Adapter筛选、缓存或输出方式的可选项。
 * @returns 包含 `bindEventPlugin`、`getBoundEventPluginKeys`、`getConfig`、`sendText`、`unbindEventPlugin` 字段的Repeater宿主Adapter。
 */
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

/**
 * 根据`eventKey`、`event`、`manifest`处理复读器通用事件。
 * @param eventKey - 用于读取或更新复读器通用事件的稳定键。
 * @param event - 触发复读器通用事件的领域事件。
 * @param manifest - 用于复读器通用事件的领域对象，包含 `events` 字段。
 * @param handleMessage - 包含正文、发送目标与账号身份的待处理消息。
 * @returns 满足复读器通用事件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 执行复读器宿主回调，并把非 `Error` 拒绝值规范为带稳定消息的异常。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param method - 决定调用Repeater宿主内容、边界或目标的 `method` 值。
 * @param args - 决定调用Repeater宿主内容、边界或目标的 `args` 值；按调用方给定的顺序传递全部剩余实参。
 * @returns 调用Repeater宿主。
 * @throws 当 `typeof fn !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
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
