import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';

@Entity('qqbot_dedupe')
export class QqbotDedupe {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 255, name: 'event_key', unique: true })
  eventKey: string;

  @Column({
    default: null,
    name: 'expire_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  expireAt: Date | null;

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
