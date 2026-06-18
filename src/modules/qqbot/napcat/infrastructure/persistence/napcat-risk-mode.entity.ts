import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatRiskModeValue = 'cooldown' | 'manual_only' | 'normal';

@Entity('napcat_risk_mode')
@Index('uk_napcat_risk_mode_account', ['accountId'], { unique: true })
@Index('idx_napcat_risk_mode_mode', ['riskMode'])
export class NapcatRiskMode {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ length: 32, name: 'risk_mode' })
  riskMode: NapcatRiskModeValue;

  @Column({ default: null, length: 255, nullable: true })
  reason: null | string;

  @Column({
    default: null,
    length: 64,
    name: 'source_event',
    nullable: true,
  })
  sourceEvent: null | string;

  @KtDateTimeColumn({ default: null, name: 'expires_at', nullable: true })
  expiresAt: KtDateTime | null;

  @Column({
    default: null,
    name: 'last_evidence',
    nullable: true,
    type: 'json',
  })
  lastEvidence: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a stable Snowflake id before persisting account risk-mode state.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
