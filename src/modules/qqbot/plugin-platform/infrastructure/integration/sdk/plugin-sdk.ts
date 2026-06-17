export type QqbotPluginSendQueueSdk = {
  sendMessage(input: Record<string, unknown>): Promise<unknown>;
};

export type QqbotPluginConfigSdk = {
  getConfig(key: string): Promise<unknown>;
  setConfig(key: string, value: unknown): Promise<void>;
};

export type QqbotPluginStorageSdk = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export type QqbotPluginHttpSdk = {
  request(input: Record<string, unknown>): Promise<unknown>;
};

export type QqbotPluginAssetSdk = {
  readAsset(assetKey: string): Promise<Buffer>;
};

export type QqbotPluginRuntimeEventSdk = {
  emitRuntimeEvent(input: Record<string, unknown>): Promise<void>;
};

export type QqbotPluginSdkFactoryInput = {
  assets: QqbotPluginAssetSdk;
  config: QqbotPluginConfigSdk;
  eventContext: Record<string, unknown>;
  events: QqbotPluginRuntimeEventSdk;
  http: QqbotPluginHttpSdk;
  operationContext: Record<string, unknown>;
  sendQueue: QqbotPluginSendQueueSdk;
  storage: QqbotPluginStorageSdk;
};

export type QqbotPluginSdk = Readonly<QqbotPluginSdkFactoryInput>;

/**
 * 创建 QQBot 插件平台对象或配置。
 * @param input - input 输入；使用 `assets`、`config`、`eventContext`、`events` 字段生成结果。
 * @returns 创建后的 QQBot 插件平台对象或配置。
 */
export const createQqbotPluginSdk = (
  input: QqbotPluginSdkFactoryInput,
): QqbotPluginSdk => {
  return Object.freeze({
    assets: input.assets,
    config: input.config,
    eventContext: Object.freeze({ ...input.eventContext }),
    events: input.events,
    http: input.http,
    operationContext: Object.freeze({ ...input.operationContext }),
    sendQueue: input.sendQueue,
    storage: input.storage,
  });
};
