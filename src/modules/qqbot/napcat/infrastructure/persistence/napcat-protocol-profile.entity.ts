import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatProtocolProfileStatus =
  | 'drifted'
  | 'failed'
  | 'pending'
  | 'synced';

@Entity('napcat_protocol_profile')
@Index('idx_napcat_protocol_profile_account', ['accountId'])
@Index('idx_napcat_protocol_profile_container', ['containerId'])
export class NapcatProtocolProfile {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({
    default: null,
    name: 'container_id',
    nullable: true,
    type: 'bigint',
  })
  containerId: null | string;

  @Column({ length: 64, name: 'profile_version' })
  profileVersion: string;

  @Column({ length: 64, name: 'packet_backend' })
  packetBackend: string;

  @Column({ default: '', length: 255, name: 'packet_server' })
  packetServer: string;

  @Column({ default: 1, name: 'o3_hook_mode', type: 'int' })
  o3HookMode: number;

  @Column({ default: false, name: 'o3_hook_gray_enabled' })
  o3HookGrayEnabled: boolean;

  @Column({
    default: null,
    length: 128,
    name: 'onebot_config_hash',
    nullable: true,
  })
  onebotConfigHash: null | string;

  @Column({
    default: null,
    name: 'onebot_config_json',
    nullable: true,
    type: 'json',
  })
  onebotConfigJson: null | Record<string, unknown>;

  @Column({
    default: null,
    length: 128,
    name: 'napcat_config_hash',
    nullable: true,
  })
  napcatConfigHash: null | string;

  @Column({
    default: null,
    name: 'napcat_config_json',
    nullable: true,
    type: 'json',
  })
  napcatConfigJson: null | Record<string, unknown>;

  @Column({ length: 32, name: 'profile_status' })
  profileStatus: NapcatProtocolProfileStatus;

  @Column({
    default: null,
    name: 'last_check_evidence',
    nullable: true,
    type: 'json',
  })
  lastCheckEvidence: null | Record<string, unknown>;

  @KtDateTimeColumn({
    default: null,
    name: 'last_checked_at',
    nullable: true,
  })
  lastCheckedAt: KtDateTime | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a stable Snowflake id before persisting protocol-profile evidence.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
