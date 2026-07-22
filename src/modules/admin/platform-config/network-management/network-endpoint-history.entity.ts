import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
} from '@/common';
import type { EndpointEventType } from './network-management.types';

@Entity('network_endpoint_history')
@Index('uk_network_endpoint_history_event_id', ['eventId'], { unique: true })
@Index('idx_network_endpoint_history_mapping', ['mappingId', 'occurredAt'])
export class NetworkEndpointHistory {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 128, name: 'event_id' })
  eventId: string;

  @Column({ name: 'mapping_id', type: 'bigint' })
  mappingId: string;

  @Column({ length: 16, name: 'event_type' })
  eventType: EndpointEventType;

  @Column({ length: 15, name: 'public_ipv4', nullable: true })
  publicIpv4?: string | null;

  @Column({ name: 'public_port', nullable: true, type: 'int' })
  publicPort?: number | null;

  @KtDateTimeColumn({ name: 'first_observed_at', type: 'datetime' })
  firstObservedAt: KtDateTime;

  @KtDateTimeColumn({ name: 'last_observed_at', type: 'datetime' })
  lastObservedAt: KtDateTime;

  @KtDateTimeColumn({ name: 'occurred_at', type: 'datetime' })
  occurredAt: KtDateTime;

  @Column({ length: 128, nullable: true })
  reason?: string | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  /**
   * Assigns a Snowflake string before the append-only event is persisted.
   * @returns The assigned endpoint history identifier.
   */
  @BeforeInsert()
  createId(): string {
    return ensureSnowflakeId(this);
  }
}
