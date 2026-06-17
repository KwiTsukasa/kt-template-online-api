import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import type { QqbotAccountAbilityType } from '../../../contract/qqbot.types';

@Entity('qqbot_account_ability')
@Index('uk_qqbot_account_ability', ['accountId', 'abilityType', 'abilityKey'], {
  unique: true,
})
@Index('idx_qqbot_account_ability_self', ['selfId', 'abilityType', 'isDeleted'])
export class QqbotAccountAbility {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ length: 64, name: 'self_id' })
  selfId: string;

  @Column({ length: 32, name: 'ability_type' })
  abilityType: QqbotAccountAbilityType;

  @Column({ length: 128, name: 'ability_key' })
  abilityKey: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

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
