import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatRuntimeProfileStatus =
  | 'drifted'
  | 'failed'
  | 'pending'
  | 'synced';

@Entity('napcat_runtime_profile')
@Index('idx_napcat_runtime_profile_account', ['accountId'])
@Index('idx_napcat_runtime_profile_container', ['containerId'])
export class NapcatRuntimeProfile {
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

  @Column({
    default: null,
    name: 'device_identity_id',
    nullable: true,
    type: 'bigint',
  })
  deviceIdentityId: null | string;

  @Column({ length: 64, name: 'profile_version' })
  profileVersion: string;

  @Column({ length: 255, name: 'image_ref' })
  imageRef: string;

  @Column({ default: null, length: 255, name: 'image_digest', nullable: true })
  imageDigest: null | string;

  @Column({
    default: null,
    length: 255,
    name: 'base_image_digest',
    nullable: true,
  })
  baseImageDigest: null | string;

  @Column({
    default: null,
    length: 64,
    name: 'desktop_profile_version',
    nullable: true,
  })
  desktopProfileVersion: null | string;

  @Column({ default: false, name: 'locale_available' })
  localeAvailable: boolean;

  @Column({
    default: null,
    name: 'fontconfig_evidence',
    nullable: true,
    type: 'json',
  })
  fontconfigEvidence: null | Record<string, unknown>;

  @Column({
    default: null,
    name: 'timezone_evidence',
    nullable: true,
    type: 'json',
  })
  timezoneEvidence: null | Record<string, unknown>;

  @Column({ default: null, name: 'runtime_uid', nullable: true, type: 'int' })
  runtimeUid: null | number;

  @Column({ default: null, name: 'runtime_gid', nullable: true, type: 'int' })
  runtimeGid: null | number;

  @Column({ default: null, length: 32, name: 'shm_size', nullable: true })
  shmSize: null | string;

  @Column({ default: null, length: 64, nullable: true })
  locale: null | string;

  @Column({
    default: null,
    length: 255,
    name: 'xdg_config_home',
    nullable: true,
  })
  xdgConfigHome: null | string;

  @Column({
    default: null,
    length: 255,
    name: 'xdg_cache_home',
    nullable: true,
  })
  xdgCacheHome: null | string;

  @Column({
    default: null,
    length: 255,
    name: 'xdg_data_home',
    nullable: true,
  })
  xdgDataHome: null | string;

  @Column({ default: true, name: 'persist_cache' })
  persistCache: boolean;

  @Column({ default: true, name: 'persist_local_share' })
  persistLocalShare: boolean;

  @Column({ default: true, name: 'persist_logs' })
  persistLogs: boolean;

  @Column({ length: 64, name: 'hostname_strategy' })
  hostnameStrategy: string;

  @Column({ length: 64, name: 'mac_strategy' })
  macStrategy: string;

  @Column({ default: false, name: 'migrate_device_identity' })
  migrateDeviceIdentity: boolean;

  @Column({ length: 32, name: 'profile_status' })
  profileStatus: NapcatRuntimeProfileStatus;

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
   * Assigns a stable Snowflake id before persisting runtime-profile evidence.
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
