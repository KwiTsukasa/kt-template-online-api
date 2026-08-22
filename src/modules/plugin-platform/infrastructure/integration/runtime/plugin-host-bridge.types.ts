export type PluginHostCallRequest = {
  args: Record<string, unknown>;
  method: string;
  pluginKey: string;
};

export type PluginHostCallResponse =
  | { ok: true; value: unknown }
  | { message: string; ok: false };
