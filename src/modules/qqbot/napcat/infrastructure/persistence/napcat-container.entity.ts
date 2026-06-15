import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotNapcatContainerStatus } from '@/modules/qqbot/core/contract/qqbot.types';

@Entity('napcat_container')
@Index('uk_napcat_container_name', ['containerName'], { unique: true })
export class NapcatContainer {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ length: 128, name: 'container_name' })
  containerName: string;

  @Column({ length: 255, name: 'image_name' })
  imageName: string;

  @Column({ length: 32 })
  status: QqbotNapcatContainerStatus;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
