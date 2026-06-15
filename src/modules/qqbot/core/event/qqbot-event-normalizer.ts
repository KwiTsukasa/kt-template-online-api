import type { ToolsService } from '@/common';
import type {
  QqbotMessageType,
  QqbotNormalizedMessage,
  QqbotOneBotEvent,
} from '../contract/qqbot.types';

export function isOneBotMessageEvent(
  payload: QqbotOneBotEvent,
): payload is QqbotOneBotEvent & { message_type: string } {
  return (
    payload?.post_type === 'message' &&
    !!normalizeMessageType(payload.message_type)
  );
}

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

export function buildDedupeKey(message: QqbotNormalizedMessage) {
  return [
    message.selfId,
    message.messageType,
    message.targetId,
    message.userId,
    message.messageId,
  ].join(':');
}

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

function normalizeMessageType(messageType?: string): QqbotMessageType | null {
  if (messageType === 'private' || messageType === 'group') {
    return messageType;
  }
  if (messageType === 'channel' || messageType === 'guild') {
    return 'channel';
  }
  return null;
}
