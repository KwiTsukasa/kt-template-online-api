import { Inject, Injectable, Optional } from '@nestjs/common';
import type { QqbotPluginExecutionInput } from '@/modules/qqbot/core/domain/plugin-execution.port';
import {
  QQBOT_PLUGIN_INPUT_NORMALIZER,
  type QqbotPluginInputNormalizerPort,
} from './plugin-input-normalizer.port';

@Injectable()
export class QqbotPluginArgumentParserService {
  constructor(
    @Optional()
    @Inject(QQBOT_PLUGIN_INPUT_NORMALIZER)
    private readonly normalizer?: QqbotPluginInputNormalizerPort,
  ) {}

  async normalizeInput(input: QqbotPluginExecutionInput) {
    return this.normalizer?.normalizeInput(input) || input.input;
  }
}
