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

  /**
   * 优先使用插件自定义规范化器处理执行输入；未注册规范化器时返回原始 `input`。
   * @param input - 用于优先使用插件自定义规范化器处理执行输入的结构化输入，包含 `input` 字段。
   * @returns 规范化后的优先使用插件自定义规范化器处理执行输入；主值为空时采用 `input.input` 兜底。
   */
  async normalizeInput(input: QqbotPluginExecutionInput) {
    return this.normalizer?.normalizeInput(input) || input.input;
  }
}
