import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';
import type { QqbotRuleMatchType, QqbotRuleTargetType } from '../qqbot.types';

@Entity('qqbot_rule')
export class QqbotRule {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ default: '', length: 120 })
  name: string;

  @Column({ default: 'keyword', length: 32, name: 'match_type' })
  matchType: QqbotRuleMatchType;

  @Column({ length: 500 })
  keyword: string;

  @Column({ length: 32, name: 'target_type', default: 'all' })
  targetType: QqbotRuleTargetType;

  @Column({ name: 'reply_content', type: 'text' })
  replyContent: string;

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
