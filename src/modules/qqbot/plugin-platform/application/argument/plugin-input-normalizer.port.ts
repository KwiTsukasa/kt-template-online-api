import type { QqbotPluginExecutionInput } from '@/modules/qqbot/core/domain/plugin-execution.port';

export const QQBOT_PLUGIN_INPUT_NORMALIZER = Symbol(
  'QQBOT_PLUGIN_INPUT_NORMALIZER',
);

export interface QqbotPluginInputNormalizerPort {
  normalizeInput(input: QqbotPluginExecutionInput): Promise<Record<string, any>>;
}
