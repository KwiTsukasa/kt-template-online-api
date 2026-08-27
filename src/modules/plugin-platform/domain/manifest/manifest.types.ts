export const PLUGIN_ALLOWED_PERMISSIONS = [
  'asset.read',
  'plugin.config.read',
  'plugin.config.write',
  'plugin.storage.read',
  'plugin.storage.write',
  'bot.command.read',
  'bot.event.receive',
  'bot.reply',
  'network.endpoint.read',
  'runtime.http',
] as const;

export const PLUGIN_WORKER_TYPES = [
  'child-process',
  'node-worker',
  'thread',
] as const;

export type PluginPermission = (typeof PLUGIN_ALLOWED_PERMISSIONS)[number];

export type PluginWorkerType = (typeof PLUGIN_WORKER_TYPES)[number];

export type PluginRuntimeManifest = {
  configKeys: string[];
  maxConcurrency: number;
  memoryMb: number;
  timeoutMs: number;
  workerType: PluginWorkerType;
};

export type PluginOperationManifest = {
  aliases: string[];
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  permissions: PluginPermission[];
  timeoutMs: number;
};

export type PluginEventManifest = {
  description?: string;
  eventName: string;
  handlerName: string;
  key: string;
  name: string;
};

export type PluginTaskManifest = {
  defaultCron: string;
  description?: string;
  enabled: boolean;
  handlerName: string;
  key: string;
  name: string;
  permissions: PluginPermission[];
  timeoutMs: number;
};

export type PluginAssetManifest = {
  contentHash?: string;
  key: string;
  path: string;
};

export type PluginMigrationManifest = {
  path: string;
  version: string;
};

export type PluginManifest = {
  assets: PluginAssetManifest[];
  author?: string;
  configSchema: Record<string, unknown>;
  description?: string;
  entry: string;
  events: PluginEventManifest[];
  homepage?: string;
  legacyAliases: string[];
  license?: string;
  migrations: PluginMigrationManifest[];
  minApiSdkVersion: string;
  name: string;
  operations: PluginOperationManifest[];
  permissions: PluginPermission[];
  key: string;
  pluginKey: string;
  runtime: PluginRuntimeManifest;
  tasks: PluginTaskManifest[];
  version: string;
};

export type PluginManifestValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type PluginManifestParseOptions = {
  pluginRoot?: string;
};
