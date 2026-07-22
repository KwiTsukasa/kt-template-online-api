import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type {
  KeeperStatus,
  PortForwardProtocol,
  PortForwardSyncStatus,
  DesiredPresence,
} from './network-management.types';

@Entity('network_port_forward')
@Index('uk_network_port_forward_active_key', ['activeKey'], { unique: true })
export class NetworkPortForward {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ nullable: true, type: 'text' })
  remark?: string | null;

  @Column({ length: 8 })
  protocol: PortForwardProtocol;

  @Column({ name: 'external_port', type: 'int', unsigned: true })
  externalPort: number;

  @Column({ name: 'internal_port', type: 'int', unsigned: true })
  internalPort: number;

  @Column({ length: 32, name: 'active_key', nullable: true })
  activeKey?: string | null;

  @Column({ length: 15, name: 'target_ipv4' })
  targetIpv4: string;

  @Column({ default: 'present', length: 16, name: 'desired_presence' })
  desiredPresence: DesiredPresence;

  @Column({
    default: false,
    name: 'keeper_desired_enabled',
    type: 'boolean',
  })
  keeperDesiredEnabled: boolean;

  @Column({ length: 64, name: 'probe_request_id', nullable: true })
  probeRequestId?: string | null;

  @Column({ default: '0', name: 'desired_revision', type: 'bigint' })
  desiredRevision: string;

  @KtDateTimeColumn({ name: 'desired_issued_at', type: 'datetime' })
  desiredIssuedAt: KtDateTime;

  @Column({ default: '0', name: 'reported_revision', type: 'bigint' })
  reportedRevision: string;

  @Column({ default: 'pending', length: 16, name: 'sync_status' })
  syncStatus: PortForwardSyncStatus;

  @Column({ default: 'disabled', length: 16, name: 'keeper_status' })
  keeperStatus: KeeperStatus;

  @Column({ length: 15, name: 'current_public_ipv4', nullable: true })
  currentPublicIpv4?: string | null;

  @Column({ name: 'current_public_port', nullable: true, type: 'int' })
  currentPublicPort?: number | null;

  @KtDateTimeColumn({
    name: 'current_observed_at',
    nullable: true,
    type: 'datetime',
  })
  currentObservedAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'current_valid_until',
    nullable: true,
    type: 'datetime',
  })
  currentValidUntil?: KtDateTime | null;

  @Column({ length: 15, name: 'last_observed_ipv4', nullable: true })
  lastObservedIpv4?: string | null;

  @Column({ name: 'last_observed_port', nullable: true, type: 'int' })
  lastObservedPort?: number | null;

  @KtDateTimeColumn({
    name: 'last_observed_at',
    nullable: true,
    type: 'datetime',
  })
  lastObservedAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_error_code', nullable: true })
  lastErrorCode?: string | null;

  @Column({ length: 512, name: 'last_error_message', nullable: true })
  lastErrorMessage?: string | null;

  @Column({ default: false, name: 'is_deleted', type: 'boolean' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a Snowflake string before the desired mapping is first persisted.
   * @returns The assigned stable mapping identifier.
   */
  @BeforeInsert()
  createId(): string {
    return ensureSnowflakeId(this);
  }
}
