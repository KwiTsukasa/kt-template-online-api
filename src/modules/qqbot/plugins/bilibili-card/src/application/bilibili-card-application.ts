import { readBilibiliCardRuntimeConfig } from '../config/bilibili-card-config';
import type {
  BilibiliCardManifest,
  BilibiliCardMessage,
  BilibiliCardPluginHost,
  BilibiliVideoReference,
} from '../domain/bilibili-card.types';
import { formatBilibiliVideoReply } from '../domain/bilibili-reply-formatter';
import { extractBilibiliUrls } from '../domain/bilibili-url-extractor';
import { parseBilibiliVideoReference } from '../domain/bilibili-url-parser';
import { BilibiliVideoClient } from '../infrastructure/integration/bilibili-video-client';

export class BilibiliCardApplication {
  private readonly boundCache = new Map<
    string,
    { expiresAt: number; value: boolean }
  >();
  private readonly dedupe = new Map<string, { expiresAt: number }>();
  private readonly videoClient: BilibiliVideoClient;

  /**
   * Initializes the Bilibili card application service.
   * @param host - Package-local host facade for bindings, HTTP, send and warning capabilities.
   * @param manifest - Package manifest metadata containing the plugin key.
   * @param now - Millisecond clock used by binding cache and conversation dedupe.
   */
  constructor(
    private readonly host: BilibiliCardPluginHost,
    private readonly manifest: BilibiliCardManifest,
    private readonly now: () => number = Date.now,
  ) {
    this.videoClient = new BilibiliVideoClient(host);
  }

  /**
   * Handles one normalized QQBot message event and replies with a Bilibili video summary when applicable.
   * @param message - Normalized QQBot message plus raw OneBot event/card payload.
   * @returns `true` when a summary was sent; otherwise `false`.
   */
  async handleMessage(message: BilibiliCardMessage) {
    if (message.userId === message.selfId) return false;
    if (!(await this.isBound(message.selfId))) return false;

    const config = readBilibiliCardRuntimeConfig(this.host);
    const urls = extractBilibiliUrls({
      messageText: message.messageText,
      rawEvent: message.rawEvent,
      rawMessage: message.rawMessage,
    });

    for (const url of urls) {
      const reference = await this.resolveReference(url, config);
      if (!reference) continue;

      this.pruneDedupe();
      const dedupeKey = buildBilibiliCardDedupeKey(message, reference);
      if (this.dedupe.has(dedupeKey)) continue;

      try {
        const video = await this.videoClient.fetchVideo(reference, config);
        await this.host.sendText({
          channelId: message.channelId,
          guildId: message.rawEvent.guild_id
            ? `${message.rawEvent.guild_id}`
            : undefined,
          message: formatBilibiliVideoReply(video, config),
          selfId: message.selfId,
          targetId: message.targetId,
          targetType: message.messageType,
        });
        this.dedupe.set(dedupeKey, {
          expiresAt: this.now() + config.dedupeTtlMs,
        });
        return true;
      } catch (error) {
        this.warn(`Bilibili 卡片解析失败: ${normalizeError(error)}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Resolves direct Bilibili URLs or `b23.tv` short links into video references.
   * @param url - Candidate URL extracted from normalized text or raw card payload.
   * @param config - Runtime redirect settings read from the plugin config snapshot.
   * @returns Parsed video reference, or `null` when the URL is unsupported or resolution fails.
   */
  private async resolveReference(
    url: string,
    config: { httpTimeoutMs: number; maxRedirects: number },
  ): Promise<BilibiliVideoReference | null> {
    const direct = parseBilibiliVideoReference(url);
    if (direct) return direct;
    if (!isB23ShortLink(url)) return null;

    try {
      const resolved = await this.host.resolveRedirect({
        maxRedirects: config.maxRedirects,
        timeoutMs: config.httpTimeoutMs,
        url,
      });
      return parseBilibiliVideoReference(resolved.finalUrl);
    } catch (error) {
      this.warn(`Bilibili 短链解析失败: ${normalizeError(error)}`);
      return null;
    }
  }

  /**
   * Checks whether this event plugin is bound to the current QQBot account.
   * @param selfId - QQBot self account id from the normalized message.
   * @returns `true` when the account has the Bilibili card event plugin bound.
   */
  private async isBound(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) return false;

    const current = this.now();
    const cached = this.boundCache.get(normalizedSelfId);
    if (cached && cached.expiresAt > current) return cached.value;

    const config = readBilibiliCardRuntimeConfig(this.host);
    try {
      const value = (
        await this.host.getBoundEventPluginKeys(normalizedSelfId)
      ).includes(this.manifest.pluginKey);
      this.boundCache.set(normalizedSelfId, {
        expiresAt: current + Math.min(config.dedupeTtlMs, 60000),
        value,
      });
      return value;
    } catch (error) {
      this.warn(`Bilibili 事件绑定查询失败: ${normalizeError(error)}`);
      return false;
    }
  }

  /**
   * Removes expired conversation/video dedupe entries before processing a new candidate.
   */
  private pruneDedupe() {
    const current = this.now();
    for (const [key, state] of this.dedupe.entries()) {
      if (state.expiresAt <= current) this.dedupe.delete(key);
    }
  }

  /**
   * Emits a warning through the package host without failing event dispatch.
   * @param message - Warning message safe for platform logs.
   */
  private warn(message: string) {
    try {
      const result = this.host.warn?.(message) as unknown;
      if (isThenable(result)) {
        result.catch(() => undefined);
      }
    } catch {
      return;
    }
  }
}

/**
 * Builds a dedupe key scoped by account, conversation target and canonical video id.
 * @param message - Normalized QQBot message being handled.
 * @param reference - Parsed Bilibili video reference.
 * @returns Stable dedupe key for one video in one conversation.
 */
function buildBilibiliCardDedupeKey(
  message: BilibiliCardMessage,
  reference: BilibiliVideoReference,
) {
  return [
    message.selfId,
    message.messageType,
    message.targetId,
    reference.canonicalVideoId,
  ].join(':');
}

/**
 * Checks whether a candidate URL is a `b23.tv` short link that requires redirect resolution.
 * @param url - Candidate URL extracted by the domain extractor.
 * @returns `true` when the hostname is exactly `b23.tv`.
 */
function isB23ShortLink(url: string) {
  try {
    return new URL(url).hostname.toLowerCase() === 'b23.tv';
  } catch {
    return false;
  }
}

/**
 * Detects promise-like warning results so rejected async loggers cannot escape later.
 * @param value - Return value from the optional host warning hook.
 * @returns `true` when the value exposes a callable `catch` method.
 */
function isThenable(
  value: unknown,
): value is { catch: (handler: () => void) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'catch' in value &&
    typeof value.catch === 'function'
  );
}

/**
 * Converts thrown values to stable warning text.
 * @param error - Error or arbitrary thrown value from host or domain code.
 * @returns Human-readable message.
 */
function normalizeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : `${error}`;
}
