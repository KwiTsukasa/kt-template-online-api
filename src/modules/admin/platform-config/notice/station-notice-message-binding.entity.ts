import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

@Entity('station_notice_message_binding')
@Index('uk_station_notice_message_binding_active_key', ['activeKey'], {
  unique: true,
})
export class StationNoticeMessageBinding {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'subscription_id', type: 'bigint' }) subscriptionId: string;
  @Column({ length: 255 }) title: string;
  @Column({ length: 64, name: 'notify_role_code' }) notifyRoleCode: string;
  @Column({ default: true }) enabled: boolean;
  @Column({ length: 255, name: 'active_key', nullable: true })
  activeKey: null | string;
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
