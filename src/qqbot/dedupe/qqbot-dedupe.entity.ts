import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';

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
  expireAt: Date | null;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
