import type { ToolsService } from '@/common';
import type {
  QqbotMessageType,
  QqbotNormalizedMessage,
  QqbotOneBotEvent,
} from '../../contract/qqbot.types';

/**
 * 判断 QQBot 核心条件。
 * @param payload - payload 输入；使用 `message_type` 字段计算判断结果。
 * @returns 布尔值，表示 QQBot 核心条件是否满足。
 */
export function isOneBotMessageEvent(
  payload: QqbotOneBotEvent,
): payload is QqbotOneBotEvent & { message_type: string } {
  return (
    payload?.post_type === 'message' &&
    !!normalizeMessageType(payload.message_type)
  );
}

/**
 * 转换 QQBot 核心输入。
 * @param payload - payload 输入；使用 `message_type`、`channel_id`、`guild_id`、`group_id` 字段生成结果。
 * @param toolsService - ToolsService 依赖；执行 `toolsService.toStringId()` 对应的 QQBot步骤。
 * @returns QQBot 核心转换后的值。
 */
export function normalizeOneBotMessage(
  payload: QqbotOneBotEvent,
  toolsService: ToolsService,
): QqbotNormalizedMessage {
  const messageType = normalizeMessageType(payload.message_type) || 'private';
  const channelId =
    toolsService.toStringId(payload.channel_id) ||
    toolsService.toStringId(payload.guild_id) ||
    undefined;
  const groupId = toolsService.toStringId(payload.group_id) || undefined;
  const userId = toolsService.toStringId(payload.user_id);
  const targetId =
    messageType === 'group'
      ? groupId || ''
      : messageType === 'channel'
        ? channelId || ''
        : userId;
  const messageText = extractMessageText(payload);

  return {
    channelId,
    eventTime: payload.time
      ? new Date(Number(payload.time) * 1000)
      : new Date(),
    groupId,
    messageId:
      toolsService.toStringId(payload.message_id) ||
      `${payload.time || Date.now()}-${targetId}-${userId}`,
    messageText,
    messageType,
    rawEvent: payload,
    rawMessage: payload.raw_message || messageText,
    selfId: toolsService.toStringId(payload.self_id),
    senderNickname:
      payload.sender?.card ||
      payload.sender?.nickname ||
      payload.sender?.user_id ||
      '',
    targetId,
    userId,
  };
}

/**
 * 创建 QQBot 核心对象或配置。
 * @param message - message 输入；使用 `selfId`、`messageType`、`targetId`、`userId` 字段生成结果。
 */
export function buildDedupeKey(message: QqbotNormalizedMessage) {
  return [
    message.selfId,
    message.messageType,
    message.targetId,
    message.userId,
    message.messageId,
  ].join(':');
}

/**
 * 查询 QQBot 核心数据。
 * @param payload - payload 输入；使用 `notice_type`、`sub_type`、`message`、`reason` 字段生成结果。
 */
export function getOneBotOfflineReason(payload: QqbotOneBotEvent) {
  if (payload?.post_type !== 'notice') return null;

  const noticeType = `${payload.notice_type || ''}`.trim();
  const subType = `${payload.sub_type || ''}`.trim();
  const content = [
    payload.message,
    payload.reason,
    payload.raw_message,
    payload.title,
    payload.tips,
    payload.loginError,
  ]
    .filter((item) => typeof item === 'string' && item.trim())
    .join(' ')
    .trim();
  const probe = `${noticeType} ${subType} ${content}`;
  const isBotOfflineNotice =
    ['bot_offline', 'bot_self_offline', 'bot_login_expired'].includes(
      noticeType,
    ) ||
    ['kick_offline', 'kicked_offline', 'login_expired'].includes(subType) ||
    /KickedOffLine|下线通知|账号状态变更为离线|登录已失效|登录态失效|另一台终端/i.test(
      probe,
    );
  if (!isBotOfflineNotice) {
    return null;
  }

  const source = [noticeType, subType].filter(Boolean).join('/') || 'offline';
  const message = content
    .replace(/\[KickedOffLine\]/gi, '')
    .replace(/\[下线通知\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${source}：${message || '账号已离线，请重新登录'}`;
}

/**
 * 执行 QQBot 核心流程。
 * @param payload - payload 输入；使用 `raw_message`、`message` 字段生成结果。
 */
function extractMessageText(payload: QqbotOneBotEvent) {
  if (payload.raw_message) return payload.raw_message;
  if (typeof payload.message === 'string') return payload.message;
  if (!Array.isArray(payload.message)) return '';

  return payload.message
    .filter((segment) => segment?.type === 'text')
    .map((segment) => segment?.data?.text || '')
    .join('')
    .trim();
}

/**
 * 转换 QQBot 核心输入。
 * @param messageType - messageType 输入；决定 QQBot条件分支。
 * @returns QQBot 核心转换后的值。
 */
function normalizeMessageType(messageType?: string): QqbotMessageType | null {
  if (messageType === 'private' || messageType === 'group') {
    return messageType;
  }
  if (messageType === 'channel' || messageType === 'guild') {
    return 'channel';
  }
  return null;
}
