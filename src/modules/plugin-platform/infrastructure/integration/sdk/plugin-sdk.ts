export type PluginConfigSdk = {
  getConfig(key: string): Promise<unknown>;
  setConfig(key: string, value: unknown): Promise<void>;
};

export type PluginStorageSdk = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export type PluginHttpSdk = {
  request(input: Record<string, unknown>): Promise<unknown>;
};

export type PluginAssetSdk = {
  readAsset(assetKey: string): Promise<Buffer>;
};

export type PluginRuntimeEventSdk = {
  emitRuntimeEvent(input: Record<string, unknown>): Promise<void>;
};

export type PluginSdkFactoryInput = {
  assets: PluginAssetSdk;
  config: PluginConfigSdk;
  eventContext: Record<string, unknown>;
  events: PluginRuntimeEventSdk;
  http: PluginHttpSdk;
  operationContext: Record<string, unknown>;
  storage: PluginStorageSdk;
};

export type PluginSdk = Readonly<PluginSdkFactoryInput>;

export const createPluginSdk = (
  input: PluginSdkFactoryInput,
): PluginSdk => {
  return Object.freeze({
    assets: input.assets,
    config: input.config,
    eventContext: Object.freeze({ ...input.eventContext }),
    events: input.events,
    http: input.http,
    operationContext: Object.freeze({ ...input.operationContext }),
    storage: input.storage,
  });
};
