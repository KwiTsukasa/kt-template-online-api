import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';
import type { QqbotCommandParserType, QqbotRuleTargetType } from '../qqbot.types';

@Entity('qqbot_command')
export class QqbotCommand {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 80 })
  code: string;

  @Column({ default: '', length: 120 })
  name: string;

  @Column({ type: 'text' })
  aliases: string;

  @Column({ default: '/,!,！', length: 120 })
  prefixes: string;

  @Column({ length: 80, name: 'plugin_key' })
  pluginKey: string;

  @Column({ length: 120, name: 'operation_key' })
  operationKey: string;

  @Column({ default: 'plain', length: 40, name: 'parser_key' })
  parserKey: QqbotCommandParserType;

  @Column({ default: 'all', length: 32, name: 'target_type' })
  targetType: QqbotRuleTargetType;

  @Column({ default: null, name: 'default_params', nullable: true, type: 'text' })
  defaultParams: string | null;

  @Column({ default: null, name: 'reply_template', nullable: true, type: 'text' })
  replyTemplate: string | null;

  @Column({ default: null, name: 'error_template', nullable: true, type: 'text' })
  errorTemplate: string | null;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: 0 })
  priority: number;

  @Column({ default: 1500, name: 'cooldown_ms' })
  cooldownMs: number;

  @Column({
    default: null,
    name: 'last_hit_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  lastHitAt: Date | null;

  @Column({ default: '', length: 255 })
  remark: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

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
