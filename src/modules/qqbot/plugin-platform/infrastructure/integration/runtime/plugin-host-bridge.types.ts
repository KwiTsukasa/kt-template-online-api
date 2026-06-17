export type QqbotPluginHostCallRequest = {
  args: Record<string, unknown>;
  method: string;
  pluginKey: string;
};

export type QqbotPluginHostCallResponse =
  | { ok: true; value: unknown }
  | { message: string; ok: false };
