import type { BotPluginOperationInput } from '@/modules/plugin-platform/contract/plugin-protocol';

export const PLUGIN_INPUT_NORMALIZER = Symbol(
  'PLUGIN_INPUT_NORMALIZER',
);

export interface PluginInputNormalizerPort {
  normalizeInput(input: BotPluginOperationInput): Promise<Record<string, any>>;
}
