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

  async getAliases(command: QqbotCommand) {
    return this.mergeLists(
      await this.getManifestAliases(command),
      this.normalizeList(command.aliases, [command.code, command.name]),
    );
  }

  getPrefixes(command: QqbotCommand) {
    return this.normalizeList(command.prefixes, ['/', '!', '！']);
  }

  private pickArgs(source: string, commandText: string) {
    if (!commandText) return null;
    if (source === commandText) return '';
    if (source.startsWith(`${commandText} `)) {
      return source.slice(commandText.length).trim();
    }
    return null;
  }

  private parseRawInput(rawArgs: string) {
    const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    return {
      args,
      raw: rawArgs,
      text: rawArgs,
    };
  }

  private normalizeList(value: string | undefined, fallback: string[]) {
    const raw = `${value || ''}`.trim();
    const parsed = this.tryParseJsonArray(raw);
    const source = parsed.length > 0 ? parsed : raw.split(',');
    const list = [...source, ...fallback]
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    return [...new Set(list)];
  }

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

  private mergeLists(...sources: string[][]) {
    return [
      ...new Set(sources.flat().map((item) => item.trim()).filter(Boolean)),
    ];
  }

  private normalizeArray(value: unknown[]) {
    return value.map((item) => `${item || ''}`).filter(Boolean);
  }

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
