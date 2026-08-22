import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type PluginInstallStatus =
  | 'disabled'
  | 'enabled'
  | 'failed'
  | 'installed'
  | 'uninstalled'
  | 'upgrading'
  | 'uploaded'
  | 'validated';

export type PluginRuntimeStatus =
  | 'crashed'
  | 'healthy'
  | 'starting'
  | 'stopped'
  | 'unhealthy';

export type PluginRuntimeEventLevel = 'error' | 'info' | 'warn';

export type PluginTaskRuntimeStatus =
  | 'disabled'
  | 'failed'
  | 'idle'
  | 'running'
  | 'scheduled';

export type PluginTaskRunStatus =
  | 'failed'
  | 'running'
  | 'skipped'
  | 'success';

export type PluginTaskTriggerType = 'bootstrap' | 'manual' | 'schedule';

@Entity('plugin')
@Index('uk_plugin_key', ['pluginKey'], { unique: true })
export class Plugin {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 128, name: 'plugin_key' })
  pluginKey: string;

  @Column({ length: 128, name: 'plugin_name' })
  pluginName: string;

  @Column({ name: 'description', nullable: true, type: 'text' })
  description: null | string;

  @Column({ length: 32 })
  status: PluginInstallStatus;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('plugin_version')
@Index('uk_plugin_version', ['pluginId', 'version'], { unique: true })
export class PluginVersion {
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

@Entity('plugin_installation')
@Index('idx_plugin_installation_status', ['status'])
export class PluginInstallation {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'version_id', type: 'bigint' })
  versionId: string;

  @Column({ length: 32 })
  status: PluginInstallStatus;

  @Column({ length: 32, name: 'runtime_status' })
  runtimeStatus: PluginRuntimeStatus;

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

@Entity('plugin_operation')
@Index('uk_plugin_operation', ['pluginId', 'operationKey'], {
  unique: true,
})
export class PluginOperation {
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

@Entity('plugin_event_handler')
@Index('uk_plugin_event_handler', ['pluginId', 'eventKey'], {
  unique: true,
})
export class PluginEventHandler {
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

@Entity('plugin_config')
@Index('uk_plugin_config', ['pluginId', 'configKey'], { unique: true })
export class PluginConfig {
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

@Entity('plugin_asset')
@Index('uk_plugin_asset', ['pluginId', 'assetKey'], { unique: true })
export class PluginAsset {
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

@Entity('plugin_runtime_event')
@Index('idx_plugin_runtime_event_plugin', ['pluginId'])
export class PluginRuntimeEvent {
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
  level: PluginRuntimeEventLevel;

  @Column({ name: 'safe_summary', nullable: true, type: 'simple-json' })
  safeSummary: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('plugin_task')
@Index('uk_plugin_task', ['installationId', 'taskKey'], {
  unique: true,
})
@Index('idx_plugin_task_plugin', ['pluginId'])
@Index('idx_plugin_task_enabled', ['enabled'])
@Index('idx_plugin_task_status', ['runtimeStatus'])
export class PluginTask {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ length: 128, name: 'task_key' })
  taskKey: string;

  @Column({ length: 128, name: 'task_name' })
  taskName: string;

  @Column({ length: 128, name: 'handler_name' })
  handlerName: string;

  @Column({ name: 'description', nullable: true, type: 'text' })
  description: null | string;

  @Column({ length: 64, name: 'default_cron' })
  defaultCron: string;

  @Column({ length: 64, name: 'cron_expression' })
  cronExpression: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'timeout_ms', type: 'int' })
  timeoutMs: number;

  @Column({ length: 32, name: 'runtime_status' })
  runtimeStatus: PluginTaskRuntimeStatus;

  @Column({ name: 'last_run_id', nullable: true, type: 'bigint' })
  lastRunId: null | string;

  @KtDateTimeColumn({ name: 'last_run_at', nullable: true })
  lastRunAt: null | KtDateTime;

  @Column({ length: 32, name: 'last_status', nullable: true })
  lastStatus: null | PluginTaskRunStatus;

  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError: null | string;

  @Column({ name: 'last_duration_ms', nullable: true, type: 'int' })
  lastDurationMs: null | number;

  @KtDateTimeColumn({ name: 'next_run_at', nullable: true })
  nextRunAt: null | KtDateTime;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('plugin_task_run')
@Index('idx_plugin_task_run_task_time', ['taskId', 'createTime'])
@Index('idx_plugin_task_run_plugin_time', ['pluginId', 'createTime'])
@Index('idx_plugin_task_run_status_time', ['status', 'createTime'])
export class PluginTaskRun {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'task_id', type: 'bigint' })
  taskId: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ length: 128, name: 'task_key' })
  taskKey: string;

  @Column({ length: 32, name: 'trigger_type' })
  triggerType: PluginTaskTriggerType;

  @Column({ length: 32 })
  status: PluginTaskRunStatus;

  @Column({ length: 191, name: 'job_id', nullable: true })
  jobId: null | string;

  @KtDateTimeColumn({ name: 'started_at', nullable: true })
  startedAt: null | KtDateTime;

  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: null | KtDateTime;

  @Column({ name: 'duration_ms', nullable: true, type: 'int' })
  durationMs: null | number;

  @Column({ name: 'safe_summary', nullable: true, type: 'simple-json' })
  safeSummary: null | Record<string, unknown>;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

export const PLUGIN_PLATFORM_ENTITIES = [
  Plugin,
  PluginVersion,
  PluginInstallation,
  PluginOperation,
  PluginEventHandler,
  PluginConfig,
  PluginAsset,
  PluginRuntimeEvent,
  PluginTask,
  PluginTaskRun,
] as const;
