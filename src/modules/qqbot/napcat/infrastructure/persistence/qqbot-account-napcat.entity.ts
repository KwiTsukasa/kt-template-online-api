import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotAccountNapcatBindStatus } from '../../../core/contract/qqbot.types';

@Entity('qqbot_account_napcat')
@Index('idx_qqbot_account_napcat_account', ['accountId', 'isDeleted'])
@Index('idx_qqbot_account_napcat_container', ['containerId', 'isDeleted'])
export class QqbotAccountNapcat {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'container_id', type: 'bigint' })
  containerId: string;

  @Column({ default: 'pending', length: 32, name: 'bind_status' })
  bindStatus: QqbotAccountNapcatBindStatus;

  @Column({ default: true, name: 'is_primary' })
  isPrimary: boolean;

  @KtDateTimeColumn({
    default: null,
    name: 'last_login_at',
    nullable: true,
    type: 'datetime',
  })
  lastLoginAt: KtDateTime | null;

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
