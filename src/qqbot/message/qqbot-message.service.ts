import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotConversation } from './qqbot-conversation.entity';
import { QqbotMessage } from './qqbot-message.entity';
import type {
  QqbotConversationQueryDto,
  QqbotMessageQueryDto,
} from './qqbot-message.dto';
import type { QqbotMessageType, QqbotNormalizedMessage } from '../qqbot.types';
import { getPageParams } from '../qqbot.utils';

@Injectable()
export class QqbotMessageService {
  constructor(
    @InjectRepository(QqbotConversation)
    private readonly conversationRepository: Repository<QqbotConversation>,
    @InjectRepository(QqbotMessage)
    private readonly messageRepository: Repository<QqbotMessage>,
  ) {}

  async conversationPage(query: QqbotConversationQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
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

  async messagePage(query: QqbotMessageQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
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
      groupId: params.messageType === 'group' ? params.targetId : null,
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
