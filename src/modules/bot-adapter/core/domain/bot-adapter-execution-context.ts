export type BotAdapterExecutionContext = {
  pluginKeys: string[];
  refreshPluginKeys?: () => Promise<string[]>;
  startThinking?: () => () => void;
};
