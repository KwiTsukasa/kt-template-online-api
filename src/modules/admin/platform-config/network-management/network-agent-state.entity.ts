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

  @Column({ default: '0', name: 'applied_revision', type: 'bigint' })
  appliedRevision: string;

  @Column({ default: false, type: 'boolean' })
  online: boolean;

  @Column({ length: 64, nullable: true })
  version?: string | null;

  @KtDateTimeColumn({ name: 'started_at', nullable: true, type: 'datetime' })
  startedAt?: KtDateTime | null;

  @KtDateTimeColumn({
    name: 'last_heartbeat_at',
    nullable: true,
    type: 'datetime',
  })
  lastHeartbeatAt?: KtDateTime | null;

  @Column({ length: 64, name: 'last_mqtt_error_code', nullable: true })
  lastMqttErrorCode?: string | null;

  @Column({ length: 500, name: 'last_mqtt_error_message', nullable: true })
  lastMqttErrorMessage?: string | null;

  @Column({ length: 64, name: 'last_reconcile_error_code', nullable: true })
  lastReconcileErrorCode?: string | null;

  @Column({ length: 500, name: 'last_reconcile_error_message', nullable: true })
  lastReconcileErrorMessage?: string | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}
