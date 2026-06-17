import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotAccountNapcatBindStatus } from '@/modules/qqbot/core/contract/qqbot.types';

@Entity('napcat_account_binding')
@Index('uk_napcat_account_binding_account', ['accountId'], { unique: true })
@Index('idx_napcat_account_binding_container', ['containerId', 'isDeleted'])
export class NapcatAccountBinding {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'container_id', type: 'bigint' })
  containerId: string;

  @Column({
    default: null,
    name: 'device_identity_id',
    nullable: true,
    type: 'bigint',
  })
  deviceIdentityId: null | string;

  @Column({ default: 'pending', length: 32, name: 'status' })
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

  /**
   * 创建 NapCat 登录运行态对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
