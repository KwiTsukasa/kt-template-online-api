export type Ff14MarketManifestOperation = {
  cacheTtlMs?: number;
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
};

export type Ff14MarketManifest = {
  description?: string;
  legacyAliases?: string[];
  name: string;
  operations: Ff14MarketManifestOperation[];
  pluginKey: string;
  version: string;
};
