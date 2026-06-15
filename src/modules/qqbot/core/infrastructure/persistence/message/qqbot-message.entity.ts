import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotMessageDirection, QqbotMessageType } from '../../../contract/qqbot.types';

@Entity('qqbot_message')
@Index('idx_qqbot_message_self_message', ['selfId', 'messageId'])
export class QqbotMessage {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 64, name: 'self_id' })
  selfId: string;

  @Column({ default: null, length: 64, name: 'message_id', nullable: true })
  messageId: null | string;

  @Column({
    default: null,
    length: 64,
    name: 'conversation_id',
    nullable: true,
  })
  conversationId: null | string;

  @Column({ default: 'inbound', length: 32 })
  direction: QqbotMessageDirection;

  @Column({ length: 32, name: 'message_type' })
  messageType: QqbotMessageType;

  @Column({ length: 64, name: 'target_id' })
  targetId: string;

  @Column({ default: null, length: 64, name: 'group_id', nullable: true })
  groupId: null | string;

  @Column({ length: 64, name: 'user_id' })
  userId: string;

  @Column({ default: '', length: 120, name: 'sender_nickname' })
  senderNickname: string;

  @Column({ name: 'raw_message', type: 'text' })
  rawMessage: string;

  @Column({ name: 'message_text', type: 'text' })
  messageText: string;

  @Column({ name: 'raw_event', nullable: true, type: 'simple-json' })
  rawEvent: Record<string, any>;

  @KtDateTimeColumn({ name: 'event_time', type: 'datetime' })
  eventTime: KtDateTime;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
