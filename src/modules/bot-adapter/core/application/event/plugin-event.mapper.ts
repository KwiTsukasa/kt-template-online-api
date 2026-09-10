import { createHash } from 'node:crypto';
import type {
  BotConversationScope,
  BotPluginMessageEvent,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import type { BotNormalizedMessage } from '../../contract/bot.types';

const EMBEDDED_JSON_MAX_BYTES = 64 * 1024;
const LINK_SCAN_MAX_DEPTH = 10;

/**
 * 将适配器消息投影为 opaque 插件信封，区分真正的图片附件和正文中的普通链接。
 * @param message - 已由 NapCat 或 Tencent 适配器归一化的消息。
 * @returns 插件协议层可消费的会话、发送者、正文、图片与链接上下文。
 */
export function toBotPluginMessageEvent(
  message: BotNormalizedMessage,
): BotPluginMessageEvent {
  return {
    conversationKey: hashOpaqueKey([
      message.selfId,
      message.messageType,
      message.targetId,
    ]),
    eventId: message.messageId,
    imageUrls: collectImageUrls(message),
    isSelf: message.userId === message.selfId,
    links: collectHttpLinks([
      message.messageText,
      message.rawMessage,
      message.rawEvent,
    ]),
    metadata: {
      mentioned: isBotMentioned(message),
      sender: {
        key: hashOpaqueKey([message.selfId, message.userId]),
        platformId: message.userId,
        name: message.senderNickname || '',
      },
      timestamp: message.eventTime.toISOString(),
      mentions: collectMentions(message),
      replyTo: collectReplyId(message),
      quote: collectQuote(message),
    },
    rawText: message.rawMessage,
    scope: toPluginScope(message.messageType),
    senderKey: hashOpaqueKey([message.selfId, message.userId]),
    text: message.messageText,
  };
}

/**
 * 保留协议中可验证的被提及者，不把昵称、正文中的数字或 QQ 号猜成平台身份。
 * @param message - 带原始消息段和官方事件的消息。
 * @returns 同一账号命名空间中的成员标识与昵称。
 */
function collectMentions(message: BotNormalizedMessage) {
  const ids = new Map<string, string>();
  const botIds = new Set([
    message.selfId,
    message.selfId.replace('qq-official:', ''),
    'all',
  ]);
  const raw = message.rawEvent || {};
  if (Array.isArray(raw.mentions)) {
    for (const item of raw.mentions) {
      const id = String(
        item?.member_openid || item?.id || item?.user_openid || '',
      );
      if (item?.is_you === true) {
        botIds.add(id);
        continue;
      }
      if (id)
        ids.set(id, String(item.nickname || item.username || item.name || ''));
    }
  }
  if (Array.isArray(raw.message)) {
    for (const item of raw.message) {
      if (item?.type === 'at' && item.data?.qq)
        ids.set(String(item.data.qq), '');
    }
  }
  for (const match of String(raw.content || '').matchAll(
    /<@!?([a-zA-Z0-9_-]+)>/gu,
  )) {
    ids.set(match[1], ids.get(match[1]) || '');
  }
  return [...ids]
    .filter(([id]) => !botIds.has(id))
    .map(([id, name]) => ({
      key: hashOpaqueKey([message.selfId, id]),
      platformId: id,
      name,
    }));
}

/**
 * 读取真正的引用消息标识，避免把当前消息的被动回复凭据误作引用对象。
 * @param message - 含官方引用字段或 OneBot 回复段的消息。
 * @returns 被引用的平台消息标识；平台未提供时为空字符串。
 */
function collectReplyId(message: BotNormalizedMessage): string {
  const raw = message.rawEvent || {};
  const reference =
    raw.message_reference?.message_id ||
    raw.message_reference?.messageId ||
    raw.ref_msg_idx;
  if (reference) return String(reference);
  if (Array.isArray(raw.message)) {
    const segment = raw.message.find((item) => item?.type === 'reply');
    if (segment?.data?.id) return String(segment.data.id);
  }
  return '';
}

/**
 * 保留官方协议携带的被引用正文，不伪造平台未给出的作者。
 * @param message - 含引用索引和消息元素的入站消息。
 * @returns 引用原文与索引；未提供引用时为空值。
 */
function collectQuote(message: BotNormalizedMessage) {
  const raw = message.rawEvent || {};
  if (!raw.ref_msg_idx || !Array.isArray(raw.msg_elements)) return null;
  const element =
    raw.msg_elements.find((item) => item?.msg_idx === raw.ref_msg_idx) ||
    raw.msg_elements[0];
  if (typeof element?.content !== 'string') return null;
  return {
    messageIndex: String(raw.ref_msg_idx),
    text: element.content.slice(0, 4000),
  };
}

/**
 * 从已接收的平台事件类型或结构化提及段确认当前 Bot 被点名，不把正文中的相似文字当作提及。
 * @param message - 带平台来源及原始协议事件的规范消息。
 * @returns 官方提及事件或明确指向当前账号的 OneBot 提及段存在时返回真。
 */
function isBotMentioned(message: BotNormalizedMessage): boolean {
  if (
    ['official-websocket', 'official-webhook'].includes(message.connectionMode)
  ) {
    if (
      Array.isArray(message.rawEvent?.mentions) &&
      message.rawEvent.mentions.some((item) => item?.is_you === true)
    )
      return true;
    return ['GROUP_AT_MESSAGE_CREATE', 'AT_MESSAGE_CREATE'].includes(
      String(message.rawEvent?.official_event_type || ''),
    );
  }
  if (message.connectionMode !== 'reverse-ws') return false;
  const segments = message.rawEvent?.message;
  if (!Array.isArray(segments)) return false;
  return segments.some(
    (segment) =>
      segment?.type === 'at' &&
      String(segment.data?.qq || '') === message.selfId,
  );
}

/**
 * 只从官方图片附件或 OneBot 图片段提取图片，不把卡片预览和普通 URL 当成用户发图。
 * @param message - 保留适配器附件及消息段的规范消息。
 * @returns 按附件顺序去重的图片地址；空地址保留为不可读取的图片，供消费方明确提示。
 */
export function collectImageUrls(message: BotNormalizedMessage): string[] {
  const images: string[] = [];
  const attachments = message.rawEvent?.attachments;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      if (
        typeof attachment.content_type !== 'string' ||
        !attachment.content_type.toLowerCase().startsWith('image/')
      ) {
        continue;
      }
      images.push(normalizeImageUrl(attachment.url));
    }
  }
  const segments = message.rawEvent?.message;
  if (Array.isArray(segments)) {
    for (const segment of segments) {
      if (segment?.type !== 'image') continue;
      images.push(normalizeImageUrl(segment.data?.url || segment.data?.file));
    }
  }
  return [...new Set(images)];
}

/**
 * 将平台图片地址规范为 HTTP(S)，拒绝本地文件、内联载荷、凭据及无法解析的地址。
 * @param value - 平台附件携带的图片 URL。
 * @returns 可交给多模态接口的远程 URL；附件地址不可用时返回空字符串。
 */
function normalizeImageUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) {
    return '';
  }
  let source = value.trim();
  if (source.startsWith('//')) source = `https:${source}`;
  try {
    const url = new URL(source);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * 将当前消息目标类型映射为跨平台 direct、group 或 channel 作用域。
 * @param messageType - 当前适配器的消息目标类型。
 * @returns 插件协议层会话作用域。
 */
function toPluginScope(
  messageType: BotNormalizedMessage['messageType'],
): BotConversationScope {
  if (messageType === 'private') return 'direct';
  if (messageType === 'group') return 'group';
  return 'channel';
}

/**
 * 将带长度边界的适配器身份片段写入 SHA-256，使插件只能比较稳定键而无法反解平台账号字段。
 * @param parts - 组成 opaque 身份的原始适配器片段。
 * @returns 六十四位小写十六进制稳定键。
 */
function hashOpaqueKey(parts: string[]) {
  const hash = createHash('sha256');
  parts.forEach((part) => {
    hash.update(`${Buffer.byteLength(part, 'utf8')}:`);
    hash.update(part);
  });
  return hash.digest('hex');
}

/**
 * 从正文和适配器原始事件的字符串叶子中抽取去重 HTTP(S) 链接，并以访问预算避免循环或超大对象拖慢事件链。
 * @param sources - 可能包含字符串、数组或普通对象的链接来源。
 * @returns 按首次出现顺序排列的绝对 HTTP(S) URL。
 */
function collectHttpLinks(sources: unknown[]) {
  const links: string[] = [];
  const seenObjects = new Set<object>();
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (visited >= 500 || depth > LINK_SCAN_MAX_DEPTH) return;
    visited += 1;
    if (typeof value === 'string') {
      const matches = value.match(/https?:\/\/[^\s<>'"\]]+/giu) || [];
      matches.forEach((match) => {
        if (!links.includes(match)) links.push(match);
      });
      const embedded = parseEmbeddedJson(value);
      if (embedded) visit(embedded, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(value as Record<string, unknown>).forEach((item) =>
      visit(item, depth + 1),
    );
  };
  sources.forEach((source) => visit(source, 0));
  return links;
}

/**
 * 对协议段中的有界字符串化 JSON 做一次安全展开，使通用链接投影能够读取卡片内部 URL。
 * @param value - 可能由 OneBot JSON 段或其他适配器携带的字符串。
 * @returns 解析后的普通对象或数组；不是有界 JSON 时返回 `null`。
 */
function parseEmbeddedJson(value: string): null | object {
  const source = value.trim();
  if (!source || Buffer.byteLength(source, 'utf8') > EMBEDDED_JSON_MAX_BYTES) {
    return null;
  }
  if (!source.startsWith('{') && !source.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as object;
  } catch {
    return null;
  }
}
