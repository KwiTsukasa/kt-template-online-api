import type { PluginManifest } from '@/modules/plugin-platform/domain/manifest';

export type PluginPackageDescriptor = {
  entry: string;
  entryFile: string;
  manifest: PluginManifest;
  packageRoot: string;
  pluginKey: string;
};

export type PluginRuntimeConfigSnapshot = Record<
  string,
  string | undefined
>;
