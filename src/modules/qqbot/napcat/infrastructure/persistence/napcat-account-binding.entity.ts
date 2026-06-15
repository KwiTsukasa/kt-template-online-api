import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotAccountNapcatBindStatus } from '@/modules/qqbot/core/contract/qqbot.types';

@Entity('napcat_account_binding')
@Index('uk_napcat_account_binding_account', ['accountId'], { unique: true })
export class NapcatAccountBinding {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'container_id', type: 'bigint' })
  containerId: string;

  @Column({ name: 'device_identity_id', type: 'bigint' })
  deviceIdentityId: string;

  @Column({ length: 32 })
  status: QqbotAccountNapcatBindStatus;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
