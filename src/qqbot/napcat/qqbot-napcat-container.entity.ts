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
import type { QqbotNapcatContainerStatus } from '../qqbot.types';

@Entity('qqbot_napcat_container')
@Index('uk_qqbot_napcat_container_name', ['name'], { unique: true })
@Index('idx_qqbot_napcat_container_status', ['status', 'isDeleted'])
export class QqbotNapcatContainer {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 255, name: 'base_url' })
  baseUrl: string;

  @Column({ name: 'webui_port', nullable: true, type: 'int' })
  webuiPort: null | number;

  @Column({
    default: null,
    length: 255,
    name: 'webui_token',
    nullable: true,
    select: false,
  })
  webuiToken: null | string;

  @Column({ default: '', length: 255 })
  image: string;

  @Column({ default: '', length: 500, name: 'data_dir' })
  dataDir: string;

  @Column({ default: '', length: 500, name: 'reverse_ws_url' })
  reverseWsUrl: string;

  @Column({ default: 'creating', length: 32 })
  status: QqbotNapcatContainerStatus;

  @Column({
    default: null,
    name: 'last_started_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  lastStartedAt: Date | null;

  @Column({
    default: null,
    name: 'last_checked_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  lastCheckedAt: Date | null;

  @Column({ default: null, length: 500, name: 'last_error', nullable: true })
  lastError: null | string;

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
