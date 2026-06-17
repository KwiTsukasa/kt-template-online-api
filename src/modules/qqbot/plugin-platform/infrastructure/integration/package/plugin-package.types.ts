import type { QqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

export type QqbotPluginPackageDescriptor = {
  entry: string;
  entryFile: string;
  manifest: QqbotPluginManifest;
  packageRoot: string;
  pluginKey: string;
};

export type QqbotPluginRuntimeConfigSnapshot = Record<
  string,
  string | undefined
>;
