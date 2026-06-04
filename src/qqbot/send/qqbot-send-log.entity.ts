import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';
import type { QqbotMessageType, QqbotSendStatus } from '../qqbot.types';

@Entity('qqbot_send_log')
@Index('idx_qqbot_send_log_target', ['selfId', 'targetType', 'targetId'])
export class QqbotSendLog {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 64, name: 'self_id' })
  selfId: string;

  @Column({ length: 32, name: 'target_type' })
  targetType: QqbotMessageType;

  @Column({ length: 64, name: 'target_id' })
  targetId: string;

  @Column({ length: 64 })
  action: string;

  @Column({ name: 'message_text', type: 'text' })
  messageText: string;

  @Column({ nullable: true, type: 'simple-json' })
  params: Record<string, any>;

  @Column({ default: 'pending', length: 32 })
  status: QqbotSendStatus;

  @Column({ default: null, length: 80, nullable: true })
  echo: null | string;

  @Column({ default: null, length: 64, name: 'message_id', nullable: true })
  messageId: null | string;

  @Column({ default: null, length: 500, name: 'error_message', nullable: true })
  errorMessage: null | string;

  @Column({ nullable: true, type: 'simple-json' })
  response: Record<string, any>;

  @CreateDateColumn({ name: 'create_time' })
  @FormatDateTime()
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  @FormatDateTime()
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
