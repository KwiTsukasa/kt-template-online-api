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
import type { QqbotAccountAbilityType } from '../qqbot.types';

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
