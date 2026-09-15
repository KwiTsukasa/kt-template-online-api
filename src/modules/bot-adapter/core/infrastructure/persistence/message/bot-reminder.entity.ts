import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  KtCreateDateColumn,
  KtUpdateDateColumn,
  type KtDateTime,
} from '@/common';
import type { BotReminderData } from '../../../contract/message/bot-reminder.port';

@Entity('bot_reminder')
@Index('idx_bot_reminder_owner', ['owner', 'status'])
@Index('idx_bot_reminder_sync', ['syncPending', 'id'])
export class BotReminder {
  @PrimaryColumn({ length: 191, collation: 'utf8mb4_bin' }) id: string;
  @Column({ length: 64 }) owner: string;
  @Column({ type: 'json' }) data: BotReminderData;
  @Column({ length: 16 }) status:
    | 'pending'
    | 'scheduled'
    | 'cancelled'
    | 'succeeded'
    | 'failed';
  @Column({ name: 'schedule_id', type: 'bigint', nullable: true }) scheduleId:
    | string
    | null;
  @Column({ name: 'sync_pending', default: true }) syncPending: boolean;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError:
    | string
    | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time' }) updateTime: KtDateTime;
}
