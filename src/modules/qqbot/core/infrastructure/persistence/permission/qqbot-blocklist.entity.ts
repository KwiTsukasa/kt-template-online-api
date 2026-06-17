import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotPermissionTargetType } from '../../../contract/qqbot.types';

@Entity('qqbot_blocklist')
export class QqbotBlocklist {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ default: '', length: 64, name: 'self_id' })
  selfId: string;

  @Column({ default: 'qq', length: 32, name: 'target_type' })
  targetType: QqbotPermissionTargetType;

  @Column({ default: '', length: 64, name: 'target_id' })
  targetId: string;

  @Column({ default: '', length: 64, name: 'user_id' })
  userId: string;

  @Column({ default: false, name: 'precise_user' })
  preciseUser: boolean;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: '', length: 255 })
  remark: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * 创建 QQBot 核心对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
