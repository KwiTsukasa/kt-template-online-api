import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { BotMessage } from '../../infrastructure/persistence/message/bot-message.entity';
import { toBotPluginMessageEvent } from '../event/plugin-event.mapper';

@Injectable()
export class BotChatHistoryService {
  constructor(
    @InjectRepository(BotMessage)
    private readonly messages: Repository<BotMessage>,
  ) {}

  /**
   * 只确认当前会话中实际出现过的成员身份，拒绝用猜测的 QQ 号或其他群账号发起提及。
   * @param message - 已绑定目标会话的真实消息。
   * @param platformId - 工具查询返回的完整平台成员标识。
   * @returns 平台可用的原始成员标识。
   * @throws 身份格式无效或从未在当前会话出现时拒绝操作。
   */
  async requireMember(
    message: BotNormalizedMessage,
    platformId: string,
  ): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(platformId))
      throw new Error('成员平台ID无效');
    if (platformId === message.userId) return platformId;
    const mentions = toBotPluginMessageEvent(message).metadata
      .mentions as Array<{ platformId: string }>;
    if (mentions.some((item) => item.platformId === platformId))
      return platformId;
    const found = await this.messages.findOne({
      where: {
        selfId: message.selfId,
        messageType: message.messageType,
        targetId: message.targetId,
        userId: platformId,
        direction: 'inbound',
      },
      select: { id: true },
    });
    if (!found)
      throw new Error('该平台成员未在当前会话出现，请先查询同群历史确认身份');
    return platformId;
  }

  /**
   * 按真实消息绑定的账号和群精确检索历史，保留发言者及分页游标，不允许模型切换目标。
   * @param message - 当前已授权的入站消息。
   * @param input - 可选关键词、历史行游标与条数。
   * @returns 按时间排列的消息及更早记录的读取游标。
   * @throws 查询参数不合法时拒绝读取。
   */
  async read(
    message: BotNormalizedMessage,
    input: Record<string, unknown> = {},
  ) {
    const limit = Number(input.limit ?? 60);
    const query = String(input.query || '').trim();
    const beforeId = String(input.beforeId || '');
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      query.length > 200
    )
      throw new Error('群历史查询参数无效');
    if (beforeId && !/^\d{1,20}$/u.test(beforeId))
      throw new Error('群历史查询参数无效');
    const builder = this.messages
      .createQueryBuilder('message')
      .where('message.selfId = :selfId', { selfId: message.selfId })
      .andWhere('message.messageType = :type', { type: message.messageType })
      .andWhere('message.targetId = :targetId', { targetId: message.targetId })
      .andWhere('message.eventTime <= :eventTime', {
        eventTime: message.eventTime,
      });
    if (beforeId) builder.andWhere('message.id < :beforeId', { beforeId });
    if (query)
      builder.andWhere('LOCATE(:query, message.messageText) > 0', { query });
    const rows = await builder
      .orderBy('message.id', 'DESC')
      .take(limit + 1)
      .getMany();
    const selected = rows.slice(0, limit);
    const result = [];
    let bytes = 0;
    for (const row of selected) {
      const event = toBotPluginMessageEvent({
        ...message,
        eventTime: new Date(row.eventTime.getTime()),
        rawEvent: row.rawEvent || {},
        messageId: row.messageId || row.id,
        messageText: row.messageText,
        rawMessage: row.rawMessage || '',
        userId: row.userId,
        senderNickname: row.senderNickname,
      });
      const item = {
        rowId: row.id,
        messageId: event.eventId,
        direction: row.direction,
        sender: event.metadata.sender,
        timestamp: event.metadata.timestamp,
        mentions: event.metadata.mentions,
        replyTo: event.metadata.replyTo,
        quote: event.metadata.quote,
        text: row.messageText.slice(0, 4000),
        truncated: row.messageText.length > 4000,
      };
      bytes += JSON.stringify(item).length;
      if (bytes > 28000 && result.length) break;
      result.push(item);
    }
    let nextBeforeId = '';
    if (rows.length > result.length && result.length)
      nextBeforeId = result[result.length - 1].rowId;
    return {
      messages: result.reverse(),
      nextBeforeId,
      scope: 'current-conversation-only',
    };
  }
}
