import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatRuntimeCleanupStatus = 'failed' | 'pending' | 'success';

@Entity('napcat_runtime_cleanup')
@Index('idx_napcat_runtime_cleanup_session', ['sessionId'])
export class NapcatRuntimeCleanup {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'session_id', type: 'bigint' })
  sessionId: string;

  @Column({ length: 64, name: 'cleanup_type' })
  cleanupType: string;

  @Column({ length: 32 })
  status: NapcatRuntimeCleanupStatus;

  @Column({ default: null, name: 'error_message', nullable: true, type: 'text' })
  errorMessage: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
