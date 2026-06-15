export type FflogsManifestOperation = {
  cacheTtlMs?: number;
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
};

export type FflogsManifest = {
  description?: string;
  legacyAliases?: string[];
  name: string;
  operations: FflogsManifestOperation[];
  pluginKey: string;
  version: string;
};
