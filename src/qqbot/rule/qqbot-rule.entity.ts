import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
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

  @KtDateTimeColumn({
    default: null,
    name: 'last_hit_at',
    nullable: true,
    type: 'datetime',
  })
  lastHitAt: KtDateTime | null;

  @Column({ default: '', length: 255 })
  remark: string;

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
