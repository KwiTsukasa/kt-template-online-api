import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ensureSnowflakeId, KtCreateDateColumn, KtDateTime, KtDateTimeColumn, KtUpdateDateColumn } from '@/common';
import type { SystemMessageFanoutStatus, SystemMessageScalar } from '../../../contract/message-push/qqbot-message-push.types';

@Entity('qqbot_message_event')
@Index('uk_qqbot_message_event_event_id', ['eventId'], { unique: true })
@Index('idx_qqbot_message_event_dispatch', ['fanoutStatus', 'nextFanoutAt'])
@Index('idx_qqbot_message_event_lease', ['fanoutLeaseUntil'])
@Index('idx_qqbot_message_event_source_resource_order', ['sourceKey', 'resourceKey', 'occurredAt', 'id'])
export class QqbotMessageEvent {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ length: 128, name: 'event_id' }) eventId: string;
  @Column({ length: 128, name: 'source_key' }) sourceKey: string;
  @Column({ length: 128, name: 'resource_key' }) resourceKey: string;
  @KtDateTimeColumn({ name: 'occurred_at', precision: 6 }) occurredAt: KtDateTime;
  @Column({ type: 'json' }) payload: Record<string, SystemMessageScalar>;
  @Column({ default: 'accepted', length: 32, name: 'fanout_status' }) fanoutStatus: SystemMessageFanoutStatus;
  @Column({ default: 0, name: 'fanout_attempt_count', type: 'int', unsigned: true }) fanoutAttemptCount: number;
  @KtDateTimeColumn({ name: 'next_fanout_at', nullable: true, precision: 6 }) nextFanoutAt: KtDateTime | null;
  @KtDateTimeColumn({ name: 'fanout_lease_until', nullable: true, precision: 6 }) fanoutLeaseUntil: KtDateTime | null;
  @Column({ length: 64, name: 'last_error_code', nullable: true }) lastErrorCode: null | string;
  @Column({ length: 500, name: 'last_error_message', nullable: true }) lastErrorMessage: null | string;
  @KtCreateDateColumn({ name: 'create_time', precision: 6 }) createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time', precision: 6 }) updateTime: KtDateTime;

  @BeforeInsert()
  createId() { ensureSnowflakeId(this); }
}
