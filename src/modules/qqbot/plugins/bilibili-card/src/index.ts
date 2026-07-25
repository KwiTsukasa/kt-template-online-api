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

function isGenericPluginOptions(
  options: BilibiliCardPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

function normalizeManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): BilibiliCardManifest {
  return {
    ...manifest,
    events: manifest.events || [],
    pluginKey: manifest.pluginKey || manifest.key || 'bilibili-card',
  };
}

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
