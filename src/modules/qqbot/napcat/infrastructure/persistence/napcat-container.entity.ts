import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotNapcatContainerStatus } from '@/modules/qqbot/core/contract/qqbot.types';

@Entity('napcat_container')
@Index('uk_napcat_container_name', ['name'], { unique: true })
@Index('idx_napcat_container_status', ['status', 'isDeleted'])
@Index('idx_napcat_container_account', ['accountId'])
export class NapcatContainer {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', nullable: true, type: 'bigint' })
  accountId: null | string;

  @Column({ length: 120, name: 'container_name' })
  name: string;

  @Column({ length: 255, name: 'base_url' })
  baseUrl: string;

  @Column({ name: 'webui_port', nullable: true, type: 'int' })
  webuiPort: null | number;

  @Column({
    default: null,
    length: 255,
    name: 'webui_token',
    nullable: true,
    select: false,
  })
  webuiToken: null | string;

  @Column({ default: '', length: 255 })
  image: string;

  @Column({ default: '', length: 500, name: 'data_dir' })
  dataDir: string;

  @Column({ default: '', length: 500, name: 'reverse_ws_url' })
  reverseWsUrl: string;

  @Column({ default: 'creating', length: 32 })
  status: QqbotNapcatContainerStatus;

  @KtDateTimeColumn({
    default: null,
    name: 'last_started_at',
    nullable: true,
    type: 'datetime',
  })
  lastStartedAt: KtDateTime | null;

  @KtDateTimeColumn({
    default: null,
    name: 'last_checked_at',
    nullable: true,
    type: 'datetime',
  })
  lastCheckedAt: KtDateTime | null;

  @Column({ default: null, length: 500, name: 'last_error', nullable: true })
  lastError: null | string;

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
