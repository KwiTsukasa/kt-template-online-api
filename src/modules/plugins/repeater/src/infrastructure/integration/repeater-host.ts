export type RepeaterPluginHost = {
  getConfig: <T = string>(key: string) => T | undefined;
  warn?: (message: string) => void;
};
