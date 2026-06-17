import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatDeviceVerificationStatus =
  | 'pending'
  | 'trusted'
  | 'unknown'
  | 'unverified';

@Entity('napcat_device_identity')
@Index('uk_napcat_device_identity_account', ['accountId'], { unique: true })
@Index('idx_napcat_device_identity_container', ['containerId'])
export class NapcatDeviceIdentity {
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

  @Column({ length: 512, name: 'data_dir' })
  dataDir: string;

  @Column({ length: 128 })
  hostname: string;

  @Column({ length: 512, name: 'machine_id_path' })
  machineIdPath: string;

  @Column({ length: 64, name: 'mac_address' })
  macAddress: string;

  @Column({ length: 32, name: 'verification_status' })
  verificationStatus: NapcatDeviceVerificationStatus;

  @Column({
    default: null,
    name: 'last_login_evidence',
    nullable: true,
    type: 'json',
  })
  lastLoginEvidence: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * 创建 NapCat 登录运行态对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
