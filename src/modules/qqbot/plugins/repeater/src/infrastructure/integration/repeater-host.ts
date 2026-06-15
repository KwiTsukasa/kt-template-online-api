export type RepeaterPluginHost = {
  bindEventPlugin: (selfId: string, pluginKey: string) => Promise<void>;
  getBoundEventPluginKeys: (selfId: string) => Promise<string[]>;
  getConfig: <T = string>(key: string) => T | undefined;
  sendText: (input: {
    channelId?: string;
    guildId?: string;
    message: string;
    selfId: string;
    targetId: string;
    targetType: string;
  }) => Promise<unknown>;
  unbindEventPlugin: (selfId: string, pluginKey: string) => Promise<void>;
  warn?: (message: string) => void;
};
