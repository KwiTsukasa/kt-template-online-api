import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatLoginEventKind =
  | 'captcha_required'
  | 'container_recreate'
  | 'container_restart'
  | 'manual_qr_created'
  | 'manual_qr_scanned'
  | 'new_device_required'
  | 'password_attempt'
  | 'quick_attempt'
  | 'recovery_suspended';

export type NapcatLoginEventSource =
  | 'admin'
  | 'runtime'
  | 'system'
  | 'watchdog';

export type NapcatLoginEventStatus =
  | 'blocked'
  | 'failed'
  | 'pending'
  | 'skipped'
  | 'success';

@Entity('napcat_login_event')
@Index('idx_napcat_login_event_account', ['accountId', 'createTime'])
@Index('idx_napcat_login_event_container', ['containerId', 'createTime'])
export class NapcatLoginEvent {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({
    default: null,
    name: 'container_id',
    nullable: true,
    type: 'bigint',
  })
  containerId: null | string;

  @Column({ length: 64, name: 'event_kind' })
  eventKind: NapcatLoginEventKind;

  @Column({ length: 32, name: 'event_source' })
  eventSource: NapcatLoginEventSource;

  @Column({ length: 32, name: 'event_status' })
  eventStatus: NapcatLoginEventStatus;

  @Column({ default: null, nullable: true, type: 'json' })
  evidence: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a stable Snowflake id before persisting a login-side risk event.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
