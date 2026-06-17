import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
@Entity('qqbot_dedupe')
export class QqbotDedupe {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 255, name: 'event_key', unique: true })
  eventKey: string;

  @KtDateTimeColumn({
    default: null,
    name: 'expire_at',
    nullable: true,
    type: 'datetime',
  })
  expireAt: KtDateTime | null;

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
