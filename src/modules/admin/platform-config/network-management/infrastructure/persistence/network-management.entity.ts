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
} from '@/modules/admin/platform-config/network-management/contract/network-management.types';

@Entity('network_port_forward')
@Index('uk_network_port_forward_active_key', ['activeKey'], { unique: true })
@Index(
  'uk_network_port_forward_active_group_protocol_key',
  ['activeGroupProtocolKey'],
  { unique: true },
)
@Index('idx_network_port_forward_group', ['groupId', 'isDeleted', 'protocol'])
export class NetworkPortForward {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ nullable: true, type: 'text' })
  remark?: string | null;

  @Column({ name: 'group_id', type: 'bigint' })
  groupId: string;

  @Column({ length: 8 })
  protocol: PortForwardProtocol;

  @Column({ name: 'external_port', type: 'int', unsigned: true })
  externalPort: number;

  @Column({ name: 'internal_port', type: 'int', unsigned: true })
  internalPort: number;

  @Column({ length: 32, name: 'active_key', nullable: true })
  activeKey?: string | null;

  @Column({
    length: 64,
    name: 'active_group_protocol_key',
    nullable: true,
  })
  activeGroupProtocolKey?: string | null;

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

  @Column({
    default: false,
    name: 'natmap_desired_enabled',
    type: 'boolean',
  })
  natmapDesiredEnabled: boolean;

  @Column({ length: 64, name: 'probe_request_id', nullable: true })
  probeRequestId?: string | null;

  @Column({ default: '0', name: 'desired_revision', type: 'bigint' })
  desiredRevision: string;

  @KtDateTimeColumn({ name: 'desired_issued_at', type: 'datetime' })
  desiredIssuedAt: KtDateTime;

  @Column({ default: '0', name: 'reported_revision', type: 'bigint' })
  reportedRevision: string;

  @KtDateTimeColumn({
    name: 'last_reported_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  lastReportedAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_reported_at_wire', nullable: true })
  lastReportedAtWire?: string | null;

  @Column({ default: 'pending', length: 16, name: 'sync_status' })
  syncStatus: PortForwardSyncStatus;

  @Column({ default: 'disabled', length: 16, name: 'keeper_status' })
  keeperStatus: KeeperStatus;

  @Column({ default: 'disabled', length: 16, name: 'natmap_status' })
  natmapStatus: string;

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
    name: 'current_validated_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  currentValidatedAt?: KtDateTime | null;

  @Column({
    length: 64,
    name: 'current_validated_at_wire',
    nullable: true,
  })
  currentValidatedAtWire?: string | null;

  @KtDateTimeColumn({
    name: 'current_valid_until',
    nullable: true,
    type: 'datetime',
  })
  currentValidUntil?: KtDateTime | null;

  @Column({
    length: 64,
    name: 'current_endpoint_identity',
    nullable: true,
    type: 'char',
  })
  currentEndpointIdentity?: string | null;

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

  @KtDateTimeColumn({
    name: 'last_observed_validated_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  lastObservedValidatedAt?: KtDateTime | null;

  @Column({
    length: 64,
    name: 'last_observed_validated_at_wire',
    nullable: true,
  })
  lastObservedValidatedAtWire?: string | null;

  @Column({ length: 15, name: 'candidate_public_ipv4', nullable: true })
  candidatePublicIpv4?: string | null;

  @Column({ name: 'candidate_public_port', nullable: true, type: 'int' })
  candidatePublicPort?: number | null;

  @KtDateTimeColumn({
    name: 'candidate_observed_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  candidateObservedAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'candidate_validated_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  candidateValidatedAt?: KtDateTime | null;

  @Column({
    length: 64,
    name: 'candidate_validated_at_wire',
    nullable: true,
  })
  candidateValidatedAtWire?: string | null;

  @Column({ length: 15, name: 'last_published_public_ipv4', nullable: true })
  lastPublishedPublicIpv4?: string | null;

  @Column({ name: 'last_published_public_port', nullable: true, type: 'int' })
  lastPublishedPublicPort?: number | null;

  @KtDateTimeColumn({
    name: 'last_published_at',
    nullable: true,
    precision: 6,
    type: 'datetime',
  })
  lastPublishedAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_error_code', nullable: true })
  lastErrorCode?: string | null;

  @Column({ length: 512, name: 'last_error_message', nullable: true })
  lastErrorMessage?: string | null;

  @Column({ length: 64, name: 'keeper_last_error_code', nullable: true })
  keeperLastErrorCode?: string | null;

  @Column({ length: 512, name: 'keeper_last_error_message', nullable: true })
  keeperLastErrorMessage?: string | null;

  @Column({ length: 64, name: 'natmap_last_error_code', nullable: true })
  natmapLastErrorCode?: string | null;

  @Column({ length: 512, name: 'natmap_last_error_message', nullable: true })
  natmapLastErrorMessage?: string | null;

  @Column({ default: false, name: 'is_deleted', type: 'boolean' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /** 创建标识。 */
  @BeforeInsert()
  createId(): string {
    return ensureSnowflakeId(this);
  }
}
