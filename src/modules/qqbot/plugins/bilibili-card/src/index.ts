import { BilibiliCardApplication } from './application/bilibili-card-application';
import type {
  BilibiliCardManifest,
  BilibiliCardMessage,
  BilibiliCardPluginHost,
} from './domain/bilibili-card.types';
import { createBilibiliCardMessageHandler } from './events/message/bilibili-card-message.handler';
import { createBilibiliCardGenericHostAdapter } from './infrastructure/integration/bilibili-card-host';

type BilibiliCardPluginOptions = {
  host: BilibiliCardPluginHost;
  manifest: BilibiliCardManifest;
  now?: () => number;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: BilibiliCardManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type BilibiliCardPluginCreateOptions =
  | BilibiliCardPluginOptions
  | QqbotGenericPluginCreateOptions;

/**
 * 根据`options`构造插件；当 `isGenericPluginOptions(options)` 成立时返回 `buildBilibiliCardPlugin({ host: createBilib…`。
 * @param options - 控制插件筛选、缓存或输出方式的可选项，包含 `host`、`runtime`、`manifest`、`now` 字段。
 * @returns 返回按运行时选项构建的插件实例。
 */
export function createPlugin(options: BilibiliCardPluginCreateOptions) {
  if (isGenericPluginOptions(options)) {
    return buildBilibiliCardPlugin({
      host: createBilibiliCardGenericHostAdapter(
        options.host,
        options.runtime.configSnapshot,
      ),
      manifest: normalizeManifest(options.manifest),
      now: () => options.now().getTime(),
    });
  }
  return buildBilibiliCardPlugin(options);
}

/**
 * 根据`options`构造Bilibili卡片插件。
 * @param options - 控制Bilibili卡片插件筛选、缓存或输出方式的可选项，包含 `host`、`manifest`、`now` 字段。
 * @returns 包含 `getDefinition`、`handleEvent`、`handleMessage` 字段的Bilibili卡片插件。
 */
function buildBilibiliCardPlugin(options: BilibiliCardPluginOptions) {
  const application = new BilibiliCardApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createBilibiliCardMessageHandler(application);

  return {
    getDefinition: () => ({
      description: options.manifest.description,
      key: options.manifest.pluginKey,
      name: options.manifest.name,
      remark: '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
      triggerType: 'message' as const,
      version: options.manifest.version,
    }),
    handleEvent: (eventKey: string, event: unknown) =>
      handleGenericEvent(eventKey, event, options.manifest, handleMessage),
    handleMessage,
  };
}

/**
 * 根据`options`与当前约束判定通用插件选项。
 * @param options - 控制通用插件选项筛选、缓存或输出方式的可选项。
 * @returns 满足通用插件选项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isGenericPluginOptions(
  options: BilibiliCardPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * 规范化清单，并输出固定投影 `events`、`pluginKey` 字段。
 * @param manifest - 用于清单的领域对象，包含 `events`、`pluginKey`、`key` 字段。
 * @returns 包含 `events`、`pluginKey` 字段的清单。
 */
function normalizeManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): BilibiliCardManifest {
  return {
    ...manifest,
    events: manifest.events || [],
    pluginKey: manifest.pluginKey || manifest.key || 'bilibili-card',
  };
}

/**
 * 根据`eventKey`、`event`、`manifest`处理通用事件。
 * @param eventKey - 用于读取或更新通用事件的稳定键。
 * @param event - 触发通用事件的领域事件。
 * @param manifest - 用于通用事件的领域对象，包含 `events` 字段。
 * @param handleMessage - 包含正文、发送目标与账号身份的待处理消息。
 * @returns 满足通用事件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
async function handleGenericEvent(
  eventKey: string,
  event: unknown,
  manifest: BilibiliCardManifest,
  handleMessage: (message: BilibiliCardMessage) => Promise<boolean>,
) {
  const matched = (manifest.events || []).some((item) =>
    [item.key, item.eventName, item.handlerName].includes(eventKey),
  );
  if (!matched && eventKey !== 'message') return false;
  return handleMessage(event as BilibiliCardMessage);
}
