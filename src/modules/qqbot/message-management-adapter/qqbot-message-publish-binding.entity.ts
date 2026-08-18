import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

@Entity('qqbot_message_publish_binding')
@Index('uk_qqbot_message_publish_binding_active_key', ['activeKey'], {
  unique: true,
})
export class QqbotMessagePublishBinding {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'subscription_id', type: 'bigint' }) subscriptionId: string;
  @Column({ name: 'account_id', type: 'bigint' }) accountId: string;
  @Column({ length: 64, name: 'self_id' }) selfId: string;
  @Column({ length: 255, name: 'active_key', nullable: true }) activeKey:
    | null
    | string;
  @Column({ default: true }) enabled: boolean;
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
