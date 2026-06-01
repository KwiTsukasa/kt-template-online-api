import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import type { QqbotAccountNapcatBindStatus } from '../qqbot.types';

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

  @Column({
    default: null,
    name: 'last_login_at',
    nullable: true,
    type: 'datetime',
  })
  lastLoginAt: Date | null;

  @Column({ default: '', length: 255 })
  remark: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
