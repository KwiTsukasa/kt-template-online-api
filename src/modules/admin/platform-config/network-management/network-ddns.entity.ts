import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type {
  NetworkDdnsRecordType,
  NetworkDdnsSourceType,
  NetworkDdnsSyncStatus,
} from './network-management.types';

@Entity('network_ddns_record')
@Index('uk_network_ddns_record_active_key', ['activeKey'], { unique: true })
@Index('idx_network_ddns_record_status', [
  'isDeleted',
  'enabled',
  'syncStatus',
  'nextRetryAt',
])
@Index('idx_network_ddns_record_port_forward', ['portForwardId'])
export class NetworkDdnsRecord {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ nullable: true, type: 'text' })
  remark?: null | string;

  @Column({ length: 8, name: 'record_type' })
  recordType: NetworkDdnsRecordType;

  @Column({ length: 32, name: 'source_type' })
  sourceType: NetworkDdnsSourceType;

  @Column({ name: 'port_forward_id', nullable: true, type: 'bigint' })
  portForwardId?: null | string;

  @Column({ length: 253 })
  domain: string;

  @Column({ length: 253, name: 'sub_domain' })
  subDomain: string;

  @Column({ length: 300, name: 'active_key', nullable: true })
  activeKey?: null | string;

  @Column({ default: false, type: 'boolean' })
  enabled: boolean;

  @Column({ default: 'disabled', length: 32, name: 'sync_status' })
  syncStatus: NetworkDdnsSyncStatus;

  @Column({ length: 32, name: 'provider_record_id', nullable: true })
  providerRecordId?: null | string;

  @Column({ length: 45, name: 'source_address', nullable: true })
  sourceAddress?: null | string;

  @Column({ length: 45, name: 'applied_address', nullable: true })
  appliedAddress?: null | string;

  @Column({ default: 0, name: 'retry_count', type: 'int', unsigned: true })
  retryCount: number;

  @KtDateTimeColumn({
    name: 'next_retry_at',
    nullable: true,
    precision: 3,
    type: 'datetime',
  })
  nextRetryAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'last_attempt_at',
    nullable: true,
    precision: 3,
    type: 'datetime',
  })
  lastAttemptAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'last_synced_at',
    nullable: true,
    precision: 3,
    type: 'datetime',
  })
  lastSyncedAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_error_code', nullable: true })
  lastErrorCode?: null | string;

  @Column({ length: 512, name: 'last_error_message', nullable: true })
  lastErrorMessage?: null | string;

  @Column({ default: false, name: 'is_deleted', type: 'boolean' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time', precision: 3, type: 'datetime' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time', precision: 3, type: 'datetime' })
  updateTime: KtDateTime;

  /**
   * Assigns a Snowflake string before the local automatic updater is persisted.
   * @returns The stable DDNS binding identifier.
   */
  @BeforeInsert()
  createId(): string {
    return ensureSnowflakeId(this);
  }
}
