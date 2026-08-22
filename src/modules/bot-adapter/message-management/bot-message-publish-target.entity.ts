import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { BotMessagePushTargetType } from './bot-message-subscriber.types';

@Entity('bot_message_publish_target')
@Index('uk_bot_message_publish_target_active_key', ['activeKey'], {
  unique: true,
})
export class BotMessagePublishTarget {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'binding_id', type: 'bigint' }) bindingId: string;
  @Column({ length: 16, name: 'target_type' })
  targetType: BotMessagePushTargetType;
  @Column({ length: 64, name: 'target_id' }) targetId: string;
  @Column({ length: 120, name: 'target_name', nullable: true }) targetName:
    | null
    | string;
  @Column({ length: 300, name: 'active_key', nullable: true }) activeKey:
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
