import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotMessageType } from '../../../contract/qqbot.types';
import type { QqbotCommandLogStatus } from '../../../contract/qqbot.types';

@Entity('qqbot_command_log')
export class QqbotCommandLog {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 64, name: 'command_id' })
  commandId: string;

  @Column({ default: '', length: 80, name: 'command_code' })
  commandCode: string;

  @Column({ length: 80, name: 'plugin_key' })
  pluginKey: string;

  @Column({ length: 120, name: 'operation_key' })
  operationKey: string;

  @Column({ default: '', length: 64, name: 'self_id' })
  selfId: string;

  @Column({ default: 'private', length: 32, name: 'target_type' })
  targetType: QqbotMessageType;

  @Column({ default: '', length: 64, name: 'target_id' })
  targetId: string;

  @Column({ default: '', length: 64, name: 'user_id' })
  userId: string;

  @Column({ name: 'raw_message', type: 'text' })
  rawMessage: string;

  @Column({ default: null, nullable: true, type: 'text' })
  input: string | null;

  @Column({ default: null, nullable: true, type: 'text' })
  output: string | null;

  @Column({ default: 'success', length: 32 })
  status: QqbotCommandLogStatus;

  @Column({
    default: null,
    name: 'error_message',
    nullable: true,
    type: 'text',
  })
  errorMessage: string | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
