import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotMessageType } from '../contract/qqbot.types';

@Entity('qqbot_conversation')
@Index('idx_qqbot_conversation_target', ['selfId', 'targetType', 'targetId'])
export class QqbotConversation {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 64, name: 'self_id' })
  selfId: string;

  @Column({ length: 32, name: 'target_type' })
  targetType: QqbotMessageType;

  @Column({ length: 64, name: 'target_id' })
  targetId: string;

  @Column({ default: '', length: 120, name: 'target_name' })
  targetName: string;

  @Column({
    default: null,
    length: 64,
    name: 'last_message_id',
    nullable: true,
  })
  lastMessageId: null | string;

  @Column({ name: 'last_message_text', type: 'text' })
  lastMessageText: string;

  @KtDateTimeColumn({
    default: null,
    name: 'last_message_time',
    nullable: true,
    type: 'datetime',
  })
  lastMessageTime: KtDateTime | null;

  @Column({ default: 0, name: 'message_count' })
  messageCount: number;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
