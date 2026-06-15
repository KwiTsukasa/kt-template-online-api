export const QQBOT_PLUGIN_ALLOWED_PERMISSIONS = [
  'asset.read',
  'plugin.config.read',
  'plugin.config.write',
  'plugin.storage.read',
  'plugin.storage.write',
  'qqbot.command.read',
  'qqbot.event.receive',
  'qqbot.send',
  'runtime.http',
] as const;

export const QQBOT_PLUGIN_WORKER_TYPES = [
  'child-process',
  'node-worker',
] as const;

export type QqbotPluginPermission =
  (typeof QQBOT_PLUGIN_ALLOWED_PERMISSIONS)[number];

export type QqbotPluginWorkerType = (typeof QQBOT_PLUGIN_WORKER_TYPES)[number];

export type QqbotPluginRuntimeManifest = {
  maxConcurrency: number;
  memoryMb: number;
  timeoutMs: number;
  workerType: QqbotPluginWorkerType;
};

export type QqbotPluginOperationManifest = {
  aliases: string[];
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  permissions: QqbotPluginPermission[];
  timeoutMs: number;
};

export type QqbotPluginEventManifest = {
  description?: string;
  eventName: string;
  handlerName: string;
  key: string;
  name: string;
};

export type QqbotPluginAssetManifest = {
  contentHash?: string;
  key: string;
  path: string;
};

export type QqbotPluginMigrationManifest = {
  path: string;
  version: string;
};

export type QqbotPluginManifest = {
  assets: QqbotPluginAssetManifest[];
  author?: string;
  configSchema: Record<string, unknown>;
  description?: string;
  entry: string;
  events: QqbotPluginEventManifest[];
  homepage?: string;
  legacyAliases: string[];
  license?: string;
  migrations: QqbotPluginMigrationManifest[];
  minApiSdkVersion: string;
  name: string;
  operations: QqbotPluginOperationManifest[];
  permissions: QqbotPluginPermission[];
  pluginKey: string;
  runtime: QqbotPluginRuntimeManifest;
  version: string;
};

export type QqbotPluginManifestValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type QqbotPluginManifestParseOptions = {
  pluginRoot?: string;
};
