import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { ensureSnowflakeId, KtCreateDateColumn, KtDateTime, KtUpdateDateColumn } from '@/common';

@Entity('qqbot_message_template')
export class QqbotMessageTemplate {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ length: 100 }) name: string;
  @Column({ length: 128, name: 'source_key' }) sourceKey: string;
  @Column({ type: 'text' }) content: string;
  @Column({ default: true }) enabled: boolean;
  @Column({ length: 500, nullable: true }) remark: null | string;
  @Column({ default: false, name: 'is_deleted' }) isDeleted: boolean;
  @KtCreateDateColumn({ name: 'create_time', precision: 6 }) createTime: KtDateTime;
  @KtUpdateDateColumn({ name: 'update_time', precision: 6 }) updateTime: KtDateTime;

  @BeforeInsert()
  createId() { ensureSnowflakeId(this); }
}
