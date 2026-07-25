import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
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

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
