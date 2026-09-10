export type BotAdapterExecutionContext = {
  pluginKeys: string[];
  refreshPluginKeys?: () => Promise<string[]>;
  startThinking?: () => () => void;
  readPlatformApi?: (input: {
    path: string;
    query?: Record<string, string>;
  }) => Promise<unknown>;
};
