import { RUN_STATUS } from '@/common/automation/constants/run-status';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtDateTimeColumn } from '@/common';
import type { DataScalar } from '@/common/automation/data-schema';
import type { TriggerDefinition } from '../../contract/trigger.types';

@Entity('automation_trigger_registration')
@Index('uk_automation_trigger_consumer', ['consumerKey'], { unique: true })
@Index('idx_automation_trigger_due', ['status', 'nextAt'])
@Index('idx_automation_trigger_source', ['status', 'eventKey', 'eventVersion'])
export class TriggerRegistration {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'consumer_key', length: 191, collation: 'utf8mb4_bin' })
  consumerKey: string;
  @Column({ name: 'trigger_id', type: 'bigint' }) triggerId: string;
  @Column({ name: 'trigger_version', type: 'int' }) triggerVersion: number;
  @Column({ type: 'json' }) definition: TriggerDefinition;
  @Column({ type: 'varchar', length: 16 }) status:
    | 'prepared'
    | 'active'
    | 'closed';
  @Column({ name: 'event_key', type: 'varchar', length: 128, nullable: true })
  eventKey: string | null;
  @Column({ name: 'event_version', type: 'int', nullable: true }) eventVersion:
    | number
    | null;
  @KtDateTimeColumn({ name: 'next_at', nullable: true })
  nextAt: KtDateTime | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}

@Entity('automation_trigger_occurrence')
@Index('uk_automation_trigger_occurrence', ['identityKey'], { unique: true })
@Index('idx_automation_trigger_pending', ['registrationId', 'status', 'id'])
@Index('idx_automation_trigger_event', ['eventReceiptId'])
export class TriggerOccurrence {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'identity_key', length: 64 }) identityKey: string;
  @Column({ name: 'registration_id', type: 'bigint' }) registrationId: string;
  @Column({ name: 'trigger_id', type: 'bigint' }) triggerId: string;
  @Column({ name: 'trigger_version', type: 'int' }) triggerVersion: number;
  @Column({
    name: 'event_receipt_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  eventReceiptId: string | null;
  @KtDateTimeColumn({ name: 'occurred_at' }) occurredAt: KtDateTime;
  @Column({ type: 'json' }) payload: Record<string, DataScalar>;
  @Column({ type: 'varchar', length: 16 }) status:
    | typeof RUN_STATUS.pending
    | 'acknowledged';
  @KtDateTimeColumn({ name: 'acknowledged_at', nullable: true })
  acknowledgedAt: KtDateTime | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}

@Entity('automation_trigger_event_receipt')
export class TriggerEventReceipt {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id: string;
  @Column({ name: 'request_hash', length: 64 }) requestHash: string;
  @Column({ name: 'event_key', length: 128 }) eventKey: string;
  @Column({ name: 'event_version', type: 'int' }) eventVersion: number;
  @KtDateTimeColumn({ name: 'occurred_at' }) occurredAt: KtDateTime;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}
