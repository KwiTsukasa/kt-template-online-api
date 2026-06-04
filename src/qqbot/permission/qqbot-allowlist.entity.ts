import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';
import type { QqbotPermissionTargetType } from '../qqbot.types';

@Entity('qqbot_allowlist')
export class QqbotAllowlist {
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

  @CreateDateColumn({ name: 'create_time' })
  @FormatDateTime()
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  @FormatDateTime()
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
