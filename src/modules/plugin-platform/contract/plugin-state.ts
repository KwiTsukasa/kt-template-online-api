export type PluginStateSnapshot = {
  revision: number;
  value: Record<string, unknown> | null;
};

export type PluginStateWrite = {
  expectedRevision: number;
  value: Record<string, unknown>;
};
