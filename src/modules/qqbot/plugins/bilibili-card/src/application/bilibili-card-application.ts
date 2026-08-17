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
  private readonly dedupe = new Map<string, { expiresAt: number }>();
  private readonly videoClient: BilibiliVideoClient;

  constructor(
    private readonly host: BilibiliCardPluginHost,
    private readonly manifest: BilibiliCardManifest,
    private readonly now: () => number = Date.now,
  ) {
    this.videoClient = new BilibiliVideoClient(host);
  }

  /** 处理消息。 */
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

  /** 解析引用。 */
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

  /** 判断已绑定的是否成立。 */
  private async isBound(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) return false;

    try {
      return (
        await this.host.getBoundEventPluginKeys(normalizedSelfId)
      ).includes(this.manifest.pluginKey);
    } catch (error) {
      this.warn(`Bilibili 事件绑定查询失败: ${normalizeError(error)}`);
      return false;
    }
  }

  /** 清理去重。 */
  private pruneDedupe() {
    const current = this.now();
    for (const [key, state] of this.dedupe.entries()) {
      if (state.expiresAt <= current) this.dedupe.delete(key);
    }
  }

  /** 返回告警。 */
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

/** 构建Bilibili卡片去重键。 */
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

/** 判断B23短的链接是否成立。 */
function isB23ShortLink(url: string) {
  try {
    return new URL(url).hostname.toLowerCase() === 'b23.tv';
  } catch {
    return false;
  }
}

/** 判断Promise 兼容对象是否成立。 */
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

/** 规范化错误。 */
function normalizeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : `${error}`;
}
