import type { ToolsService } from '@/common';
import type {
  QqbotMessageType,
  QqbotNormalizedMessage,
  QqbotOneBotEvent,
} from '../../contract/qqbot.types';

/**
 * 仅当事件类型为消息且消息类型可规范化时，才将载荷收窄为 OneBot 消息事件。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `post_type`、`message_type` 字段。
 * @returns 满足OneBot消息事件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 将`payload`、`toolsService`规范为OneBot消息，使等价输入得到一致表示。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `message_type`、`channel_id`、`guild_id`、`group_id` 字段。
 * @param toolsService - 用于OneBot消息的领域对象，包含 `toStringId` 字段。
 * @returns 包含 `channelId`、`eventTime`、`groupId`、`messageId`、`messageText` 字段的OneBot消息。
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
  const targetId = (() => {
    if (messageType === 'group') {
      return groupId || '';
    }
    if (messageType === 'channel') {
      return channelId || '';
    }
    return userId;
  })();
  const messageText = extractMessageText(payload);

  return {
    channelId,
    connectionMode: 'reverse-ws',
    eventTime: (() => {
      if (payload.time) {
        return new Date(Number(payload.time) * 1000);
      }
      return new Date();
    })(),
    groupId,
    guildId: toolsService.toStringId(payload.guild_id) || undefined,
    messageId:
      toolsService.toStringId(payload.message_id) ||
      `${payload.time || Date.now()}-${targetId}-${userId}`,
    messageText,
    messageType,
    rawEvent: payload,
    rawMessage: payload.raw_message || messageText,
    replyMessageId: toolsService.toStringId(payload.message_id) || undefined,
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
 * 按账号、消息类型、目标、用户和消息标识的固定顺序拼接去重键。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`messageType`、`targetId`、`userId` 字段。
 * @returns 按账号、消息类型、目标、用户和消息标识的固定顺序拼接去重键。
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
 * 按`payload`读取OneBotOfflineReason；当 `!isBotOfflineNotice` 成立时返回 `null`。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `post_type`、`notice_type`、`sub_type`、`message` 字段。
 * @returns 按参数编码并拼接完成的OneBotOfflineReason；无法解析或未命中时为 `null`。
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
 * 从 OneBot 事件载荷中提取消息正文，并兼容字符串与消息段数组表示。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `raw_message`、`message` 字段。
 * @returns 当前状态对应的消息文本，取值为 `''`。
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
 * 将`messageType`规范为消息Type，使等价输入得到一致表示；当 `messageType === 'private' || messageType === 'group'` 成立时返回 `messageType`。
 * @param messageType - 决定消息Type内容、边界或目标的 `messageType` 值；为空时采用 `messageType === 'group'` 作为兜底。
 * @returns 当前状态对应的消息Type，取值为 `'channel'`；无法解析或未命中时为 `null`。
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
