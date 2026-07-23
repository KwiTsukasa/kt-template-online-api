import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ensureSnowflakeId, KtCreateDateColumn, KtDateTime, KtDateTimeColumn, KtUpdateDateColumn } from '@/common';
import type { QqbotMessagePushTargetType, SystemMessageDeliveryStatus, SystemMessageScalar } from '../../../contract/message-push/qqbot-message-push.types';

@Entity('qqbot_message_delivery')
@Index('uk_qqbot_message_delivery_event_target', ['messageEventId', 'publishTargetId'], { unique: true })
@Index('idx_qqbot_message_delivery_dispatch', ['status', 'nextAttemptAt'])
@Index('idx_qqbot_message_delivery_lease', ['processingLeaseUntil'])
@Index('idx_qqbot_message_delivery_history', ['subscriptionId', 'messageEventId'])
export class QqbotMessageDelivery {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'message_event_id', type: 'bigint' }) messageEventId: string;
  @Column({ name: 'publish_target_id', type: 'bigint' }) publishTargetId: string;
  @Column({ name: 'binding_id', type: 'bigint' }) bindingId: string;
  @Column({ name: 'subscription_id', type: 'bigint' }) subscriptionId: string;
  @Column({ length: 64, name: 'self_id' }) selfId: string;
  @Column({ length: 16, name: 'target_type' }) targetType: QqbotMessagePushTargetType;
  @Column({ length: 64, name: 'target_id' }) targetId: string;
  @Column({ name: 'template_id', type: 'bigint' }) templateId: string;
  @Column({ name: 'template_content', type: 'text' }) templateContent: string;
  @Column({ name: 'variable_snapshot', type: 'json' }) variableSnapshot: Record<string, SystemMessageScalar>;
  @Column({ name: 'rendered_message', type: 'text' }) renderedMessage: string;
  @Column({ length: 32 }) status: SystemMessageDeliveryStatus;
  @Column({ default: 0, name: 'attempt_count', type: 'int', unsigned: true }) attemptCount: number;
  @KtDateTimeColumn({ name: 'next_attempt_at', nullable: true, precision: 6 }) nextAttemptAt: KtDateTime | null;
  @KtDateTimeColumn({ name: 'processing_lease_until', nullable: true, precision: 6 }) processingLeaseUntil: KtDateTime | null;
  @Column({ name: 'send_log_id', nullable: true, type: 'bigint' }) sendLogId: null | string;
  @Column({ length: 64, name: 'last_error_code', nullable: true }) lastErrorCode: null | string;
  @Column({ length: 500, name: 'last_error_message', nullable: true }) lastErrorMessage: null | string;
  @KtDateTimeColumn({ name: 'expires_at', precision: 6 }) expiresAt: KtDateTime;
  @KtCreateDateColumn({ name: 'create_time', precision: 6 }) createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time', precision: 6 }) updateTime: KtDateTime;

  /** Assigns the Snowflake primary key before this delivery task is persisted. */
  @BeforeInsert()
  createId() { ensureSnowflakeId(this); }
}
