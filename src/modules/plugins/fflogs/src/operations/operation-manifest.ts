export type FflogsManifestOperation = {
  aliases?: string[];
  cacheTtlMs?: number;
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
};

export type FflogsManifest = {
  description?: string;
  legacyAliases?: string[];
  name: string;
  operations: FflogsManifestOperation[];
  pluginKey: string;
  version: string;
};
