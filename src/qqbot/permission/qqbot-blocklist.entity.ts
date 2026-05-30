import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import type { QqbotPermissionTargetType } from '../qqbot.types';

@Entity('qqbot_blocklist')
export class QqbotBlocklist {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ default: '', length: 64, name: 'self_id' })
  selfId: string;

  @Column({ default: 'all', length: 32, name: 'target_type' })
  targetType: QqbotPermissionTargetType;

  @Column({ default: '', length: 64, name: 'target_id' })
  targetId: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: '', length: 255 })
  remark: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
