import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type {
  QqbotLoginScanSession,
  QqbotLoginScanStatus,
} from '@/modules/qqbot/core/contract/qqbot.types';

@Entity('napcat_login_session')
@Index('uk_napcat_login_session_key', ['sessionKey'], { unique: true })
@Index('idx_napcat_login_session_account', ['accountId'])
export class NapcatLoginSession {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ default: null, name: 'account_id', nullable: true, type: 'bigint' })
  accountId: null | string;

  @Column({ length: 128, name: 'session_key' })
  sessionKey: string;

  @Column({ length: 64, name: 'login_stage' })
  loginStage: string;

  @Column({ length: 32 })
  status: QqbotLoginScanStatus;

  @Column({ length: 255, name: 'progress_message' })
  progressMessage: string;

  @Column({ default: null, name: 'session_payload', nullable: true, type: 'json' })
  sessionPayload: null | QqbotLoginScanSession;

  @KtDateTimeColumn({
    default: null,
    name: 'expires_at',
    nullable: true,
    type: 'datetime',
  })
  expiresAt: KtDateTime | null;

  @KtDateTimeColumn({
    default: null,
    name: 'completed_at',
    nullable: true,
    type: 'datetime',
  })
  completedAt: KtDateTime | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
