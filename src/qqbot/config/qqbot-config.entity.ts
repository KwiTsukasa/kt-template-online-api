import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';

@Entity('qqbot_config')
@Index('uk_qqbot_config_key', ['configKey'], { unique: true })
export class QqbotConfig {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 120, name: 'config_key' })
  configKey: string;

  @Column({ name: 'config_value', type: 'text' })
  configValue: string;

  @Column({ default: '', length: 255 })
  remark: string;

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
