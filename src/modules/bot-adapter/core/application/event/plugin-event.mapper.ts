import { createHash } from 'node:crypto';
import type {
  BotConversationScope,
  BotPluginMessageEvent,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import type { BotNormalizedMessage } from '../../contract/bot.types';

const EMBEDDED_JSON_MAX_BYTES = 64 * 1024;
const LINK_SCAN_MAX_DEPTH = 10;

/**
 * 将当前 Bot 适配器消息转换为不暴露平台账号标识的插件事件信封，并提前抽取通用链接。
 * @param message - 已由 NapCat 或 Tencent 适配器归一化的消息。
 * @returns 插件协议层可消费的 opaque 会话、发送者、正文和链接上下文。
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
    isSelf: message.userId === message.selfId,
    links: collectHttpLinks([
      message.messageText,
      message.rawMessage,
      message.rawEvent,
    ]),
    metadata: {},
    rawText: message.rawMessage,
    scope: toPluginScope(message.messageType),
    senderKey: hashOpaqueKey([message.selfId, message.userId]),
    text: message.messageText,
  };
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
