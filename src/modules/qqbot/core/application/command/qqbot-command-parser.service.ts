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
  constructor(
    @Optional()
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution?: QqbotPluginExecutionPort,
  ) {}

  /**
   * 按命令别名与前缀匹配`command`、`message`中的消息文本；命中时拆分原始参数，未命中时返回空值；从 `getAliases` 读取`match` 对应结果。
   * @param command - 提供别名、命令名与允许前缀的待匹配命令定义。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `messageText` 字段。
   * @returns 包含 `alias`、`input`、`matched`、`rawArgs` 字段的`match` 对应；无法解析或未命中时为 `null`。
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
   * 通过 `mergeLists` 准备或恢复运行态。
   * @param command - 用于别名集合的领域对象，包含 `aliases`、`code`、`name` 字段。
   * @returns 别名集合。
   */
  async getAliases(command: QqbotCommand) {
    return this.mergeLists(
      await this.getManifestAliases(command),
      this.normalizeList(command.aliases, [command.code, command.name]),
    );
  }

  /**
   * 将命令前缀规范为非空列表，缺失时使用 `/`、`!`、`！` 三个默认前缀。
   * @param command - 用于将命令前缀规范为非空列表，缺失时使用 `/`、`!`、`！` 三个默认前缀的领域对象，包含 `prefixes` 字段。
   * @returns 命令前缀集合。
   */
  getPrefixes(command: QqbotCommand) {
    return this.normalizeList(command.prefixes, ['/', '!', '！']);
  }

  /**
   * 通过 `source.startsWith` 判断输入是否满足函数约束。
   * @param source - 决定启动参数内容、边界或目标的 `source` 值。
   * @param commandText - 用于启动参数的领域对象，包含 `length` 字段。
   * @returns 当前状态对应的启动参数，取值为 `''`；无法解析或未命中时为 `null`。
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
   * 从`rawArgs`解析包含 `args`、`raw`、`text` 字段的结果。
   * @param rawArgs - 决定包含 `args`、`raw`、`text` 字段的结果内容、边界或目标的 `rawArgs` 值。
   * @returns 包含 `args`、`raw`、`text` 字段的包含 `args`、`raw`、`text` 字段的。
   */
  private parseRawInput(rawArgs: string) {
    const args = (() => {
      if (rawArgs) {
        return rawArgs.split(/\s+/).filter(Boolean);
      }
      return [];
    })();
    return {
      args,
      raw: rawArgs,
      text: rawArgs,
    };
  }

  /**
   * 将`value`、`fallback`规范为`normalizeList` 对应结果，使等价输入得到一致表示。
   * @param value - 待转换为`normalizeList` 对应结果的原始值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 按输入顺序得到的`normalizeList` 对应列表；没有匹配项时为空数组。
   */
  private normalizeList(value: string | undefined, fallback: string[]) {
    const raw = `${value || ''}`.trim();
    const parsed = this.tryParseJsonArray(raw);
    const source = (() => {
      if (parsed.length > 0) {
        return parsed;
      }
      return raw.split(',');
    })();
    const list = [...source, ...fallback]
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    return [...new Set(list)];
  }

  /**
   * 按`command`读取清单别名集合；从 `pluginExecution.getOperationByCommand` 读取清单别名集合。
   * @param command - 用于清单别名集合的领域对象，包含 `operationKey`、`pluginKey` 字段。
   * @returns 按输入顺序得到的清单别名集合列表；没有匹配项时为空数组。
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
   * 通过 `filter` 筛选匹配数据。
   * @param sources - 用于Lists的领域对象，包含 `flat` 字段；按调用方给定的顺序传递全部剩余实参。
   * @returns 按输入顺序得到的Lists列表；没有匹配项时为空数组。
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
   * 通过 `filter` 筛选匹配数据。
   * @param value - 待转换为数组内容的原始值。
   * @returns 数组内容。
   */
  private normalizeArray(value: unknown[]) {
    return value.map((item) => `${item || ''}`).filter(Boolean);
  }

  /**
   * 通过 `value.startsWith` 判断输入是否满足函数约束。
   * @param value - 参与tryJSON 数据数组内容比较、格式化或输出的候选值。
   * @returns 按输入顺序得到的tryJSON 数据数组内容列表；没有匹配项时为空数组。
   */
  private tryParseJsonArray(value: string) {
    if (!value.startsWith('[')) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch {
      return [];
    }
  }
}
