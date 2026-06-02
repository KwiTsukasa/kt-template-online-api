import { Injectable } from '@nestjs/common';
import type { QqbotCommand } from './qqbot-command.entity';
import type { QqbotNormalizedMessage } from '../qqbot.types';
import {
  isQqbotFf14DataCenterName,
  isQqbotFf14LocationName,
  isQqbotFf14RegionName,
  isQqbotFf14WorldName,
  splitQqbotFf14WorldPath,
} from '../plugins/ff14Market/qqbot-ff14-worlds';

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
      if (/^hq$/i.test(token)) {
        flags.set('hq', true);
      } else if (/^nq$/i.test(token)) {
        flags.set('hq', 'false');
      } else if (token.includes('=')) {
        const [key, ...rest] = token.split('=');
        flags.set(key, rest.join('='));
      } else {
        positional.push(token);
      }
    }

    let region = this.normalizeString(flags.get('region') || flags.get('地区'));
    let dataCenter = this.normalizeString(
      flags.get('dataCenter') ||
        flags.get('datacenter') ||
        flags.get('dc') ||
        flags.get('大区'),
    );
    let world = this.normalizeString(
      flags.get('world') ||
        flags.get('server') ||
        flags.get('服务器') ||
        flags.get('小区'),
    );
    let item = positional.join(' ');

    const worldPath = splitQqbotFf14WorldPath(world);
    if (worldPath.dataCenter && worldPath.world) {
      dataCenter = dataCenter || worldPath.dataCenter;
      region = region || worldPath.region || '';
      world = worldPath.world;
    }

    if (!world && !dataCenter && positional.length > 1) {
      const picked = this.pickTrailingFf14Location(positional);
      if (picked) {
        dataCenter = picked.dataCenter || dataCenter;
        item = picked.item;
        region = picked.region || region;
        world = picked.world || world;
      }
    }
    if (item.includes('@')) {
      const [itemName, worldName] = item.split('@');
      const itemWorldPath = splitQqbotFf14WorldPath(worldName);
      item = itemName.trim();
      dataCenter = dataCenter || itemWorldPath.dataCenter || '';
      region = region || itemWorldPath.region || '';
      world = world || itemWorldPath.world || worldName?.trim();
    }

    return {
      dataCenter,
      hq: this.normalizeHq(flags.get('hq')),
      item,
      language: this.normalizeString(flags.get('lang')) || 'zh',
      raw: rawArgs,
      region,
      world,
    };
  }

  private pickTrailingFf14Location(positional: string[]) {
    const last = positional[positional.length - 1];
    if (!isQqbotFf14LocationName(last)) return null;

    const path = splitQqbotFf14WorldPath(last);
    if (path.dataCenter && path.world) {
      return {
        dataCenter: path.dataCenter,
        item: positional.slice(0, -1).join(' '),
        region: path.region,
        world: path.world,
      };
    }

    const previous = positional[positional.length - 2];
    const beforePrevious = positional[positional.length - 3];
    if (
      previous &&
      isQqbotFf14DataCenterName(previous) &&
      isQqbotFf14WorldName(last)
    ) {
      const hasRegion = beforePrevious && isQqbotFf14RegionName(beforePrevious);
      return {
        dataCenter: previous,
        item: positional.slice(0, hasRegion ? -3 : -2).join(' '),
        region: hasRegion ? beforePrevious : undefined,
        world: last,
      };
    }

    if (
      previous &&
      isQqbotFf14RegionName(previous) &&
      isQqbotFf14DataCenterName(last)
    ) {
      return {
        dataCenter: last,
        item: positional.slice(0, -2).join(' '),
        region: previous,
      };
    }

    return {
      item: positional.slice(0, -1).join(' '),
      world: last,
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
