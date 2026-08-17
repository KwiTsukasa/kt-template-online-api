import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ensureSnowflakeId, KtCreateDateColumn, KtDateTime, KtUpdateDateColumn } from '@/common';

@Entity('qqbot_message_subscription')
@Index('uk_qqbot_message_subscription_active_key', ['activeKey'], { unique: true })
export class QqbotMessageSubscription {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ length: 100 }) name: string;
  @Column({ length: 128, name: 'source_key' }) sourceKey: string;
  @Column({ name: 'source_config', type: 'json' }) sourceConfig: Record<string, unknown>;
  @Column({ length: 64, name: 'source_config_digest', type: 'char' }) sourceConfigDigest: string;
  @Column({ length: 255, name: 'active_key', nullable: true }) activeKey: null | string;
  @Column({ default: true }) enabled: boolean;
  @Column({ length: 500, nullable: true }) remark: null | string;
  @Column({ default: false, name: 'is_deleted' }) isDeleted: boolean;
  @KtCreateDateColumn({ name: 'create_time', precision: 6 }) createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time', precision: 6 }) updateTime: KtDateTime;

  @BeforeInsert()
  createId() { ensureSnowflakeId(this); }
}
