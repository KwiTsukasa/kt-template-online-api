import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

export type QqbotPluginInstallStatus =
  | 'disabled'
  | 'enabled'
  | 'failed'
  | 'installed'
  | 'uninstalled'
  | 'uploaded'
  | 'validated';

export type QqbotPluginRuntimeStatus =
  | 'crashed'
  | 'healthy'
  | 'starting'
  | 'stopped'
  | 'unhealthy';

export type QqbotPluginRuntimeEventLevel = 'error' | 'info' | 'warn';

@Entity('qqbot_plugin')
@Index('uk_qqbot_plugin_key', ['pluginKey'], { unique: true })
export class QqbotPlugin {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 128, name: 'plugin_key' })
  pluginKey: string;

  @Column({ length: 128, name: 'plugin_name' })
  pluginName: string;

  @Column({ name: 'description', nullable: true, type: 'text' })
  description: null | string;

  @Column({ length: 32 })
  status: QqbotPluginInstallStatus;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_version')
@Index('uk_qqbot_plugin_version', ['pluginId', 'version'], { unique: true })
export class QqbotPluginVersion {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ length: 64 })
  version: string;

  @Column({ length: 128, name: 'package_hash' })
  packageHash: string;

  @Column({ name: 'manifest_json', type: 'simple-json' })
  manifestJson: Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_installation')
@Index('idx_qqbot_plugin_installation_status', ['status'])
export class QqbotPluginInstallation {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'version_id', type: 'bigint' })
  versionId: string;

  @Column({ length: 32 })
  status: QqbotPluginInstallStatus;

  @Column({ length: 32, name: 'runtime_status' })
  runtimeStatus: QqbotPluginRuntimeStatus;

  @Column({ length: 512, name: 'installed_path' })
  installedPath: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_operation')
@Index('uk_qqbot_plugin_operation', ['pluginId', 'operationKey'], {
  unique: true,
})
export class QqbotPluginOperation {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ length: 128, name: 'operation_key' })
  operationKey: string;

  @Column({ length: 128, name: 'operation_name' })
  operationName: string;

  @Column({ length: 128, name: 'handler_name' })
  handlerName: string;

  @Column({ default: true })
  enabled: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_event_handler')
@Index('uk_qqbot_plugin_event_handler', ['pluginId', 'eventKey'], {
  unique: true,
})
export class QqbotPluginEventHandler {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ length: 128, name: 'event_key' })
  eventKey: string;

  @Column({ length: 128, name: 'handler_name' })
  handlerName: string;

  @Column({ default: true })
  enabled: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_account_binding')
@Index('uk_qqbot_plugin_account_binding', ['pluginId', 'accountId'], {
  unique: true,
})
export class QqbotPluginAccountBinding {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ default: true })
  enabled: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_config')
@Index('uk_qqbot_plugin_config', ['pluginId', 'configKey'], { unique: true })
export class QqbotPluginConfig {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ length: 128, name: 'config_key' })
  configKey: string;

  @Column({ name: 'config_value', nullable: true, type: 'simple-json' })
  configValue: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_asset')
@Index('uk_qqbot_plugin_asset', ['pluginId', 'assetKey'], { unique: true })
export class QqbotPluginAsset {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ length: 255, name: 'asset_key' })
  assetKey: string;

  @Column({ length: 512, name: 'asset_path' })
  assetPath: string;

  @Column({ length: 128, name: 'content_hash' })
  contentHash: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_runtime_event')
@Index('idx_qqbot_plugin_runtime_event_plugin', ['pluginId'])
export class QqbotPluginRuntimeEvent {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({
    default: null,
    name: 'installation_id',
    nullable: true,
    type: 'bigint',
  })
  installationId: null | string;

  @Column({ length: 64, name: 'event_type' })
  eventType: string;

  @Column({ length: 32 })
  level: QqbotPluginRuntimeEventLevel;

  @Column({ name: 'safe_summary', nullable: true, type: 'simple-json' })
  safeSummary: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

export const QQBOT_PLUGIN_PLATFORM_ENTITIES = [
  QqbotPlugin,
  QqbotPluginVersion,
  QqbotPluginInstallation,
  QqbotPluginOperation,
  QqbotPluginEventHandler,
  QqbotPluginAccountBinding,
  QqbotPluginConfig,
  QqbotPluginAsset,
  QqbotPluginRuntimeEvent,
] as const;
