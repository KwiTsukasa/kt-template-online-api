import type {
  QqbotMessageType,
  QqbotNormalizedMessage,
  QqbotOneBotEvent,
} from '../qqbot.types';
import { toStringId } from '../qqbot.utils';

export function isOneBotMessageEvent(
  payload: QqbotOneBotEvent,
): payload is QqbotOneBotEvent & { message_type: QqbotMessageType } {
  return payload?.post_type === 'message' && !!payload.message_type;
}

export function normalizeOneBotMessage(
  payload: QqbotOneBotEvent,
): QqbotNormalizedMessage {
  const messageType = payload.message_type as QqbotMessageType;
  const groupId = toStringId(payload.group_id) || undefined;
  const userId = toStringId(payload.user_id);
  const targetId = messageType === 'group' ? groupId || '' : userId;
  const messageText = extractMessageText(payload);

  return {
    eventTime: payload.time
      ? new Date(Number(payload.time) * 1000)
      : new Date(),
    groupId,
    messageId:
      toStringId(payload.message_id) ||
      `${payload.time || Date.now()}-${targetId}-${userId}`,
    messageText,
    messageType,
    rawEvent: payload,
    rawMessage: payload.raw_message || messageText,
    selfId: toStringId(payload.self_id),
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
