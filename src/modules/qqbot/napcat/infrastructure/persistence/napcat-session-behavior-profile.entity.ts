import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatAutoCapabilityStage =
  | 'automatic'
  | 'image_commands'
  | 'manual_only'
  | 'text_commands';

@Entity('napcat_session_behavior_profile')
@Index('idx_napcat_session_behavior_profile_account', ['accountId'])
export class NapcatSessionBehaviorProfile {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ length: 64, name: 'profile_version' })
  profileVersion: string;

  @Column({ default: true })
  enabled: boolean;

  @KtDateTimeColumn({
    default: null,
    name: 'cold_start_until',
    nullable: true,
  })
  coldStartUntil: KtDateTime | null;

  @Column({ default: false, name: 'housekeeping_enabled' })
  housekeepingEnabled: boolean;

  @Column({
    default: null,
    name: 'housekeeping_interval_ms',
    nullable: true,
    type: 'int',
  })
  housekeepingIntervalMs: null | number;

  @KtDateTimeColumn({
    default: null,
    name: 'next_housekeeping_at',
    nullable: true,
  })
  nextHousekeepingAt: KtDateTime | null;

  @KtDateTimeColumn({
    default: null,
    name: 'last_housekeeping_at',
    nullable: true,
  })
  lastHousekeepingAt: KtDateTime | null;

  @Column({
    default: null,
    name: 'last_housekeeping_result',
    nullable: true,
    type: 'json',
  })
  lastHousekeepingResult: null | Record<string, unknown>;

  @Column({ default: false, name: 'presence_enabled' })
  presenceEnabled: boolean;

  @Column({
    default: null,
    length: 64,
    name: 'presence_strategy',
    nullable: true,
  })
  presenceStrategy: null | string;

  @KtDateTimeColumn({
    default: null,
    name: 'last_presence_event_at',
    nullable: true,
  })
  lastPresenceEventAt: KtDateTime | null;

  @KtDateTimeColumn({
    default: null,
    name: 'next_presence_event_at',
    nullable: true,
  })
  nextPresenceEventAt: KtDateTime | null;

  @Column({ length: 32, name: 'auto_capability_stage' })
  autoCapabilityStage: NapcatAutoCapabilityStage;

  @Column({
    default: null,
    name: 'last_behavior_evidence',
    nullable: true,
    type: 'json',
  })
  lastBehaviorEvidence: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a stable Snowflake id before persisting session-behavior profile state.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
