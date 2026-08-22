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

  /**
   * 根据`message`处理消息；向目标通道投递结果（`host.sendText`）。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `userId`、`selfId`、`messageText`、`rawEvent` 字段。
   * @returns 满足消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
          guildId: message.guildId,
          message: formatBilibiliVideoReply(video, config),
          replyMessageId: message.replyMessageId,
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
   * 优先直接解析 Bilibili 视频引用；仅对 b23 短链跟随受限重定向，并在仍无法解析时返回空值。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param config - 限定引用边界、地址与开关的运行配置，包含 `maxRedirects`、`httpTimeoutMs` 字段。
   * @returns 引用；无法解析或未命中时为 `null`。
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
   * 根据`selfId`与当前约束判定已绑定的；从 `host.getBoundEventPluginKeys` 读取已绑定的。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 满足已绑定的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 按当前运行态移除去重；同步更新对应缓存或去重状态（`dedupe.delete`）。
   */
  private pruneDedupe() {
    const current = this.now();
    for (const [key, state] of this.dedupe.entries()) {
      if (state.expiresAt <= current) this.dedupe.delete(key);
    }
  }

  /**
   * 根据`message`处理安全记录告警。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
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
 * 根据`message`、`reference`构造Bilibili卡片去重键。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`messageType`、`targetId` 字段。
 * @param reference - 用于Bilibili卡片去重键的领域对象，包含 `canonicalVideoId` 字段。
 * @returns Bilibili卡片去重键。
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
 * 仅把主机名为 `b23.tv` 或其子域名的 URL 识别为 Bilibili 短链。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 满足B23ShortLink约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isB23ShortLink(url: string) {
  try {
    return new URL(url).hostname.toLowerCase() === 'b23.tv';
  } catch {
    return false;
  }
}

/**
 * 根据`value`与当前约束判定Promise 兼容对象。
 * @param value - 待判定是否满足Promise 兼容对象约束的候选值。
 * @returns 满足Promise 兼容对象约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
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
 * 将`error`规范为错误，使等价输入得到一致表示；当 `error instanceof Error && error.message` 成立时返回 `error.message`。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 按参数编码并拼接完成的错误。
 */
function normalizeError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return `${error}`;
}
