import { Column, Entity, PrimaryColumn } from 'typeorm';
import {
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

@Entity('network_agent_state')
export class NetworkAgentState {
  @PrimaryColumn({ length: 64, name: 'agent_id', type: 'varchar' })
  agentId: string;

  @Column({ length: 15, name: 'target_ipv4' })
  targetIpv4: string;

  @Column({ default: '0', name: 'desired_revision', type: 'bigint' })
  desiredRevision: string;

  @KtDateTimeColumn({ name: 'desired_issued_at', type: 'datetime' })
  desiredIssuedAt: KtDateTime;

  @Column({ default: '0', name: 'published_revision', type: 'bigint' })
  publishedRevision: string;

  @Column({
    default: 1,
    name: 'desired_schema_version',
    type: 'int',
    unsigned: true,
  })
  desiredSchemaVersion: number;

  @Column({
    default: 1,
    name: 'published_schema_version',
    type: 'int',
    unsigned: true,
  })
  publishedSchemaVersion: number;

  @Column({
    default: 1,
    name: 'max_supported_schema_version',
    type: 'int',
    unsigned: true,
  })
  maxSupportedSchemaVersion: number;

  @Column({ default: false, name: 'tcp_natmap_capable', type: 'boolean' })
  tcpNatmapCapable: boolean;

  @Column({ default: '0', name: 'applied_revision', type: 'bigint' })
  appliedRevision: string;

  @Column({
    default: 1,
    name: 'applied_schema_version',
    type: 'int',
    unsigned: true,
  })
  appliedSchemaVersion: number;

  @Column({ default: false, type: 'boolean' })
  online: boolean;

  @Column({ length: 128, nullable: true })
  version?: string | null;

  @KtDateTimeColumn({ name: 'started_at', nullable: true, type: 'datetime' })
  startedAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'last_heartbeat_at',
    nullable: true,
    type: 'datetime',
  })
  lastHeartbeatAt?: KtDateTime | null;

  @Column({ length: 45, name: 'current_public_ipv6', nullable: true })
  currentPublicIpv6?: string | null;

  @KtDateTimeColumn({
    name: 'current_ipv6_observed_at',
    nullable: true,
    precision: 3,
    type: 'datetime',
  })
  currentIpv6ObservedAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_mqtt_error_code', nullable: true })
  lastMqttErrorCode?: string | null;

  @Column({ length: 512, name: 'last_mqtt_error_message', nullable: true })
  lastMqttErrorMessage?: string | null;

  @Column({ length: 64, name: 'last_reconcile_error_code', nullable: true })
  lastReconcileErrorCode?: string | null;

  @Column({ length: 512, name: 'last_reconcile_error_message', nullable: true })
  lastReconcileErrorMessage?: string | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}
