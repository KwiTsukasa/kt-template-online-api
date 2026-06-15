import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type {
  QqbotConnectionMode,
  QqbotConnectionRole,
  QqbotConnectionStatus,
} from '../../../contract/qqbot.types';

@Entity('qqbot_account')
export class QqbotAccount {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ default: 'reverse-ws', length: 32, name: 'connection_mode' })
  connectionMode: QqbotConnectionMode;

  @Column({ length: 64, name: 'self_id', unique: true })
  selfId: string;

  @Column({ default: '', length: 120 })
  name: string;

  @Column({
    default: null,
    length: 255,
    name: 'access_token',
    nullable: true,
    select: false,
  })
  accessToken: null | string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: 'offline', length: 32, name: 'connect_status' })
  connectStatus: QqbotConnectionStatus;

  @Column({ default: null, length: 32, name: 'client_role', nullable: true })
  clientRole: null | QqbotConnectionRole;

  @KtDateTimeColumn({
    default: null,
    name: 'last_connected_at',
    nullable: true,
    type: 'datetime',
  })
  lastConnectedAt: KtDateTime | null;

  @KtDateTimeColumn({
    default: null,
    name: 'last_heartbeat_at',
    nullable: true,
    type: 'datetime',
  })
  lastHeartbeatAt: KtDateTime | null;

  @Column({ default: null, length: 500, name: 'last_error', nullable: true })
  lastError: null | string;

  @Column({
    default: null,
    length: 1024,
    name: 'napcat_login_password_secret',
    nullable: true,
    select: false,
  })
  napcatLoginPasswordSecret: null | string;

  @Column({ default: '', length: 255 })
  remark: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
