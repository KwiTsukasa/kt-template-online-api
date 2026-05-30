import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import type { QqbotMessageType } from '../qqbot.types';

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

  @Column({
    default: null,
    name: 'last_message_time',
    nullable: true,
    type: 'datetime',
  })
  lastMessageTime: Date | null;

  @Column({ default: 0, name: 'message_count' })
  messageCount: number;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
