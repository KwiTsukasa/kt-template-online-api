import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ensureSnowflakeId, KtCreateDateColumn, KtDateTime } from '@/common';

@Entity('qqbot_napcat_webui_gateway_audit')
@Index('idx_napcat_webui_gateway_audit_session', ['sessionId'])
@Index('idx_napcat_webui_gateway_audit_account_event', [
  'accountId',
  'eventType',
])
@Index('idx_napcat_webui_gateway_audit_admin_time', [
  'adminUserId',
  'createTime',
])
export class NapcatWebuiGatewayAudit {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 64, name: 'session_id', type: 'varchar' })
  sessionId: string;

  @Column({ name: 'admin_user_id', type: 'bigint' })
  adminUserId: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ length: 32, name: 'self_id' })
  selfId: string;

  @Column({ name: 'container_id', type: 'bigint' })
  containerId: string;

  @Column({ length: 64, name: 'event_type' })
  eventType: string;

  @Column({ default: null, length: 128, name: 'client_ip', nullable: true })
  clientIp: null | string;

  @Column({ default: null, length: 512, name: 'user_agent', nullable: true })
  userAgent: null | string;

  @Column({ default: null, name: 'detail_json', nullable: true, type: 'json' })
  detailJson: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  /**
   * Assigns a Snowflake id before persisting an Admin WebUI gateway audit row.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
