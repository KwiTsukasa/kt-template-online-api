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
 * Creates the Bilibili card plugin entry for package-local tests or the generic worker runtime.
 * @param options - Package-local options or generic worker options containing host facade and config snapshot.
 * @returns Bilibili card event plugin instance.
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
 * Builds the package-local plugin instance.
 * @param options - Package host, manifest and millisecond clock.
 * @returns Runtime plugin object consumed by tests and worker event dispatch.
 */
function buildBilibiliCardPlugin(options: BilibiliCardPluginOptions) {
  const application = new BilibiliCardApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createBilibiliCardMessageHandler(application);

  return {
    /**
     * Returns a simple event capability summary for local callers.
     * @returns Plugin event definition based on the package manifest.
     */
    getDefinition: () => ({
      description: options.manifest.description,
      key: options.manifest.pluginKey,
      name: options.manifest.name,
      remark: '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
      triggerType: 'message' as const,
      version: options.manifest.version,
    }),
    /**
     * Routes generic worker event calls to the package-owned message handler.
     * @param eventKey - Manifest event key, event name or handler name supplied by the worker.
     * @param event - Normalized QQBot message payload.
     * @returns Whether the event was handled.
     */
    handleEvent: (eventKey: string, event: unknown) =>
      handleGenericEvent(eventKey, event, options.manifest, handleMessage),
    handleMessage,
  };
}

/**
 * Checks whether create options came from the generic worker runtime.
 * @param options - Candidate options supplied to `createPlugin`.
 * @returns `true` when the runtime config snapshot exists.
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
 * Fills the manifest plugin key from the parser's legacy `key` field when needed.
 * @param manifest - Manifest supplied by the generic plugin descriptor.
 * @returns Manifest with `pluginKey` and `events` normalized.
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
 * Dispatches one generic event to the message handler when it matches the manifest event.
 * @param eventKey - Event key, event name or handler name from platform dispatch.
 * @param event - Normalized QQBot event payload.
 * @param manifest - Package manifest containing event metadata.
 * @param handleMessage - Message handler produced by the package application.
 * @returns Handler result, or `false` for unrelated events.
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
