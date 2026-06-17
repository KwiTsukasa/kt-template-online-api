import { Inject, Injectable, Optional } from '@nestjs/common';
import type { QqbotCommandMatchResult } from '../../contract/qqbot.types';
import type { QqbotNormalizedMessage } from '../../contract/qqbot.types';
import {
  QQBOT_PLUGIN_EXECUTION_PORT,
  type QqbotPluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { QqbotCommand } from '../../infrastructure/persistence/command/qqbot-command.entity';

@Injectable()
export class QqbotCommandParserService {
  /**
   * 初始化 QqbotCommandParserService 实例。
   * @param pluginExecution - pluginExecution 输入；影响 constructor 的返回值。
   */
  constructor(
    @Optional()
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution?: QqbotPluginExecutionPort,
  ) {}

  /**
   * 执行 QQBot 核心流程。
   * @param command - command 输入；驱动 `this.getAliases()`、`this.getPrefixes()` 的 QQBot步骤。
   * @param message - message 输入；使用 `messageText` 字段生成结果。
   */
  async match(command: QqbotCommand, message: QqbotNormalizedMessage) {
    const source = `${message.messageText || ''}`.trim();
    if (!source) return null;

    const aliases = await this.getAliases(command);
    const prefixes = this.getPrefixes(command);
    for (const alias of aliases) {
      for (const prefix of prefixes) {
        const commandText = `${prefix}${alias}`.trim();
        const rawArgs = this.pickArgs(source, commandText);
        if (rawArgs === null) continue;
        return {
          alias,
          input: this.parseRawInput(rawArgs),
          matched: true,
          rawArgs,
        } satisfies QqbotCommandMatchResult;
      }
    }
    return null;
  }

  /**
   * 查询 QQBot 核心数据。
   * @param command - command 输入；使用 `aliases`、`code`、`name` 字段生成结果。
   */
  async getAliases(command: QqbotCommand) {
    return this.mergeLists(
      await this.getManifestAliases(command),
      this.normalizeList(command.aliases, [command.code, command.name]),
    );
  }

  /**
   * 查询 QQBot 核心数据。
   * @param command - command 输入；使用 `prefixes` 字段生成结果。
   */
  getPrefixes(command: QqbotCommand) {
    return this.normalizeList(command.prefixes, ['/', '!', '！']);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param source - source 输入；计算 QQBot布尔判断。
   * @param commandText - commandText 输入；使用 `length` 字段生成结果。
   */
  private pickArgs(source: string, commandText: string) {
    if (!commandText) return null;
    if (source === commandText) return '';
    if (source.startsWith(`${commandText} `)) {
      return source.slice(commandText.length).trim();
    }
    return null;
  }

  /**
   * 解析Raw Input。
   * @param rawArgs - QQBot列表；生成规范化文本。
   */
  private parseRawInput(rawArgs: string) {
    const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    return {
      args,
      raw: rawArgs,
      text: rawArgs,
    };
  }

  /**
   * 转换 QQBot 核心输入。
   * @param value - 待转换值；影响 normalizeList 的返回值。
   * @param fallback - 兜底值；影响 normalizeList 的返回值。
   */
  private normalizeList(value: string | undefined, fallback: string[]) {
    const raw = `${value || ''}`.trim();
    const parsed = this.tryParseJsonArray(raw);
    const source = parsed.length > 0 ? parsed : raw.split(',');
    const list = [...source, ...fallback]
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    return [...new Set(list)];
  }

  /**
   * 查询 QQBot 核心数据。
   * @param command - command 输入；使用 `operationKey`、`pluginKey` 字段生成结果。
   */
  private async getManifestAliases(command: QqbotCommand) {
    if (!this.pluginExecution) return [];
    try {
      const operation = await this.pluginExecution.getOperationByCommand({
        operationKey: command.operationKey,
        pluginKey: command.pluginKey,
      });
      return this.normalizeArray(operation?.aliases || []);
    } catch {
      return [];
    }
  }

  /**
   * 合并Lists。
   * @param sources - QQBot列表；去重列表值。
   */
  private mergeLists(...sources: string[][]) {
    return [
      ...new Set(
        sources
          .flat()
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }

  /**
   * 转换 QQBot 核心输入。
   * @param value - 待转换值；转换 QQBot列表项。
   */
  private normalizeArray(value: unknown[]) {
    return value.map((item) => `${item || ''}`).filter(Boolean);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param value - 待转换值；计算 QQBot布尔判断。
   */
  private tryParseJsonArray(value: string) {
    if (!value.startsWith('[')) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
