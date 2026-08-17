import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolsService } from '@/common';
import { QqbotConversation } from '../../infrastructure/persistence/message/qqbot-conversation.entity';
import { QqbotMessage } from '../../infrastructure/persistence/message/qqbot-message.entity';
import type {
  QqbotConversationQueryDto,
  QqbotMessageQueryDto,
} from '../../contract/message/qqbot-message.dto';
import type {
  QqbotMessageType,
  QqbotNormalizedMessage,
} from '../../contract/qqbot.types';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';

@Injectable()
export class QqbotMessageService {
  constructor(
    @InjectRepository(QqbotConversation)
    private readonly conversationRepository: Repository<QqbotConversation>,
    @InjectRepository(QqbotMessage)
    private readonly messageRepository: Repository<QqbotMessage>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 根据`query`处理会话消息分页结果；把变更持久化到当前存储（`conversationRepository.createQueryBuilder`）。
   * @param query - 限定会话消息分页结果筛选、排序与分页范围的查询条件，包含 `selfId`、`targetType`、`targetId` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的会话消息分页。
   */
  async conversationPage(query: QqbotConversationQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.conversationRepository
      .createQueryBuilder('conversation')
      .where('conversation.isDeleted = :isDeleted', { isDeleted: false });

    if (query.selfId) {
      builder.andWhere('conversation.selfId = :selfId', {
        selfId: query.selfId,
      });
    }
    if (query.targetType) {
      builder.andWhere('conversation.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId) {
      builder.andWhere('conversation.targetId LIKE :targetId', {
        targetId: `%${query.targetId}%`,
      });
    }

    const [list, total] = await builder
      .orderBy('conversation.lastMessageTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  /**
   * 根据`query`处理消息分页结果；把变更持久化到当前存储（`messageRepository.createQueryBuilder`）。
   * @param query - 限定消息分页结果筛选、排序与分页范围的查询条件，包含 `conversationId`、`selfId`、`targetType`、`targetId` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的消息分页。
   */
  async messagePage(query: QqbotMessageQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.messageRepository.createQueryBuilder('message');

    if (query.conversationId) {
      builder.andWhere('message.conversationId = :conversationId', {
        conversationId: query.conversationId,
      });
    }
    if (query.selfId) {
      builder.andWhere('message.selfId = :selfId', {
        selfId: query.selfId,
      });
    }
    if (query.targetType) {
      builder.andWhere('message.messageType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId) {
      builder.andWhere('message.targetId LIKE :targetId', {
        targetId: `%${query.targetId}%`,
      });
    }
    if (query.keyword) {
      builder.andWhere('message.messageText LIKE :keyword', {
        keyword: `%${query.keyword}%`,
      });
    }

    const [list, total] = await builder
      .orderBy('message.eventTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  /**
   * 根据`message`更新入站消息；把变更持久化到当前存储（`messageRepository.create`）。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `eventTime`、`groupId`、`messageId`、`messageText` 字段。
   * @returns 入站消息。
   */
  async saveIncoming(message: QqbotNormalizedMessage) {
    const conversation = await this.upsertConversation(message);
    const entity = this.messageRepository.create({
      conversationId: conversation.id,
      direction: 'inbound',
      eventTime: message.eventTime,
      groupId: message.groupId || null,
      messageId: message.messageId,
      messageText: message.messageText,
      messageType: message.messageType,
      rawEvent: message.rawEvent,
      rawMessage: message.rawMessage,
      selfId: message.selfId,
      senderNickname: message.senderNickname || '',
      targetId: message.targetId,
      userId: message.userId,
    });
    return this.messageRepository.save(entity);
  }

  /**
   * 根据`params`更新出站消息；把变更持久化到当前存储（`messageRepository.create`）。
   * @param params - 用于出站消息的领域对象，包含 `messageType`、`targetId`、`messageId`、`messageText` 字段。
   * @returns 出站消息。
   */
  async saveOutgoing(params: {
    messageId?: string;
    messageText: string;
    messageType: QqbotMessageType;
    selfId: string;
    targetId: string;
    userId: string;
  }) {
    const entity = this.messageRepository.create({
      direction: 'outbound',
      eventTime: new Date(),
      groupId: (() => {
        if (params.messageType === 'group') {
          return params.targetId;
        }
        return null;
      })(),
      messageId: params.messageId || null,
      messageText: params.messageText,
      messageType: params.messageType,
      rawEvent: null,
      rawMessage: params.messageText,
      selfId: params.selfId,
      senderNickname: 'QQBot',
      targetId: params.targetId,
      userId: params.userId,
    });
    return this.messageRepository.save(entity);
  }

  /**
   * 根据`message`处理upsert会话消息；当 `!conversation` 成立时返回 `this.conversationRepository.save(conversati…`。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`targetId`、`messageType`、`messageId` 字段。
   * @returns 包含 `lastMessageId`、`messageCount` 字段的upsert会话消息。
   */
  private async upsertConversation(message: QqbotNormalizedMessage) {
    let conversation = await this.conversationRepository.findOne({
      where: {
        isDeleted: false,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      },
    });

    if (!conversation) {
      conversation = this.conversationRepository.create({
        lastMessageId: message.messageId,
        lastMessageText: message.messageText,
        lastMessageTime: message.eventTime,
        messageCount: 1,
        selfId: message.selfId,
        targetId: message.targetId,
        targetName: message.senderNickname || message.targetId,
        targetType: message.messageType,
      });
      return this.conversationRepository.save(conversation);
    }

    await this.conversationRepository.update(
      { id: conversation.id },
      {
        lastMessageId: message.messageId,
        lastMessageText: message.messageText,
        lastMessageTime: message.eventTime,
        messageCount: conversation.messageCount + 1,
        targetName: message.senderNickname || conversation.targetName,
      },
    );
    return {
      ...conversation,
      lastMessageId: message.messageId,
      messageCount: conversation.messageCount + 1,
    };
  }
}
