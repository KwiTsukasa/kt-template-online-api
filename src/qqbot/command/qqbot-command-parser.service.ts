import { Injectable } from '@nestjs/common';
import type { QqbotCommand } from './qqbot-command.entity';
import type { QqbotNormalizedMessage } from '../qqbot.types';

export type QqbotCommandMatchResult = {
  alias: string;
  input: Record<string, any>;
  matched: true;
  rawArgs: string;
};

@Injectable()
export class QqbotCommandParserService {
  match(command: QqbotCommand, message: QqbotNormalizedMessage) {
    const source = `${message.messageText || ''}`.trim();
    if (!source) return null;

    const aliases = this.getAliases(command);
    const prefixes = this.getPrefixes(command);
    for (const alias of aliases) {
      for (const prefix of prefixes) {
        const commandText = `${prefix}${alias}`.trim();
        const rawArgs = this.pickArgs(source, commandText);
        if (rawArgs === null) continue;
        return {
          alias,
          input: this.parseInput(command, rawArgs),
          matched: true,
          rawArgs,
        } satisfies QqbotCommandMatchResult;
      }
    }
    return null;
  }

  getAliases(command: QqbotCommand) {
    return this.normalizeList(command.aliases, [command.code, command.name]);
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

  private parseInput(command: QqbotCommand, rawArgs: string) {
    if (command.parserKey === 'ff14Price') {
      return this.parseFf14PriceInput(rawArgs);
    }
    const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    return {
      args,
      raw: rawArgs,
      text: rawArgs,
    };
  }

  private parseFf14PriceInput(rawArgs: string) {
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    const flags = new Map<string, string | true>();
    const positional: string[] = [];

    for (const token of tokens) {
      if (/^(hq|HQ)$/.test(token)) {
        flags.set('hq', true);
      } else if (/^(nq|NQ)$/.test(token)) {
        flags.set('hq', 'false');
      } else if (token.includes('=')) {
        const [key, ...rest] = token.split('=');
        flags.set(key, rest.join('='));
      } else {
        positional.push(token);
      }
    }

    let world = this.normalizeString(flags.get('world') || flags.get('server'));
    let item = positional.join(' ');
    if (!world && positional.length > 1) {
      world = positional[positional.length - 1];
      item = positional.slice(0, -1).join(' ');
    }
    if (item.includes('@')) {
      const [itemName, worldName] = item.split('@');
      item = itemName.trim();
      world = world || worldName?.trim();
    }

    return {
      hq: this.normalizeHq(flags.get('hq')),
      item,
      language: this.normalizeString(flags.get('lang')) || 'zh',
      raw: rawArgs,
      world,
    };
  }

  private normalizeHq(value?: string | true) {
    if (value === undefined) return undefined;
    if (value === true) return true;
    if (value === 'false') return false;
    return ['1', 'true', 'yes', 'hq'].includes(`${value}`.toLowerCase());
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

  private tryParseJsonArray(value: string) {
    if (!value.startsWith('[')) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizeString(value?: string | true) {
    if (value === true) return '';
    return `${value || ''}`.trim();
  }
}
