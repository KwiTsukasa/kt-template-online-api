import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

@Entity('message_subscription')
@Index('uk_message_subscription_active_key', ['activeKey'], { unique: true })
export class MessageSubscription {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ length: 100 }) name: string;
  @Column({ length: 64, name: 'subscriber_key' }) subscriberKey: string;
  @Column({ length: 64, name: 'template_binding_digest', type: 'char' })
  templateBindingDigest: string;
  @Column({ name: 'source_config', type: 'json' }) sourceConfig: Record<
    string,
    unknown
  >;
  @Column({ length: 64, name: 'source_config_digest', type: 'char' })
  sourceConfigDigest: string;
  @Column({ length: 255, name: 'active_key', nullable: true }) activeKey:
    | null
    | string;
  @Column({ default: true }) enabled: boolean;
  @Column({ length: 500, nullable: true }) remark: null | string;
  @Column({ default: false, name: 'is_deleted' }) isDeleted: boolean;
  @KtCreateDateColumn({ name: 'create_time', precision: 6 })
  createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time', precision: 6 })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
