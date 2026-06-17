import { Inject, Injectable, Optional } from '@nestjs/common';
import type { QqbotPluginExecutionInput } from '@/modules/qqbot/core/domain/plugin-execution.port';
import {
  QQBOT_PLUGIN_INPUT_NORMALIZER,
  type QqbotPluginInputNormalizerPort,
} from './plugin-input-normalizer.port';

@Injectable()
export class QqbotPluginArgumentParserService {
  /**
   * 初始化 QqbotPluginArgumentParserService 实例。
   * @param normalizer - normalizer 输入；影响 constructor 的返回值。
   */
  constructor(
    @Optional()
    @Inject(QQBOT_PLUGIN_INPUT_NORMALIZER)
    private readonly normalizer?: QqbotPluginInputNormalizerPort,
  ) {}

  /**
   * 转换 QQBot 插件平台输入。
   * @param input - input 输入；使用 `input` 字段生成结果。
   */
  async normalizeInput(input: QqbotPluginExecutionInput) {
    return this.normalizer?.normalizeInput(input) || input.input;
  }
}
