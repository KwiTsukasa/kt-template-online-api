import { Injectable } from '@nestjs/common';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import type { QqbotCommand } from './qqbot-command.entity';
import type { QqbotNormalizedMessage } from '../contract/qqbot.types';
import {
  buildQqbotFf14MarketCatalog,
  buildQqbotFf14MarketCatalogFromTree,
  QQBOT_FF14_MARKET_DICT_CODES,
  isQqbotFf14DataCenterName,
  isQqbotFf14LocationName,
  isQqbotFf14RegionName,
  isQqbotFf14WorldName,
  splitQqbotFf14WorldPath,
} from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-worlds';
import type { QqbotFf14MarketCatalog } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.types';
import type { QqbotCommandMatchResult } from '../contract/qqbot.types';

@Injectable()
export class QqbotCommandParserService {
  constructor(private readonly dictService: DictService) {}

  async match(command: QqbotCommand, message: QqbotNormalizedMessage) {
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
          input: await this.parseInput(command, rawArgs),
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

  private async parseInput(command: QqbotCommand, rawArgs: string) {
    if (command.parserKey === 'ff14Price') {
      return this.parseFf14PriceInput(rawArgs);
    }
    if (command.parserKey === 'fflogsCharacter') {
      return this.parseFflogsCharacterInput(rawArgs);
    }
    const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    return {
      args,
      raw: rawArgs,
      text: rawArgs,
    };
  }

  private async parseFf14PriceInput(rawArgs: string) {
    const catalog = await this.getFf14MarketCatalog();
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
      const picked = this.pickTrailingFf14Location(catalog, positional);
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
      language: this.normalizeString(flags.get('lang')) || 'chs',
      raw: rawArgs,
      region,
      world,
    };
  }

  private async parseFflogsCharacterInput(rawArgs: string) {
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    const flags = new Map<string, string | true>();
    const positional: string[] = [];

    for (const token of tokens) {
      if (token.includes('=')) {
        const [key, ...rest] = token.split('=');
        flags.set(key, rest.join('='));
      } else {
        positional.push(token);
      }
    }

    let characterName = this.normalizeString(
      flags.get('character') ||
        flags.get('name') ||
        flags.get('角色') ||
        flags.get('角色名'),
    );
    let serverSlug = this.normalizeString(
      flags.get('server') ||
        flags.get('serverSlug') ||
        flags.get('world') ||
        flags.get('服务器') ||
        flags.get('小区'),
    );
    let encounterName = this.normalizeString(
      flags.get('encounter') ||
        flags.get('encounterName') ||
        flags.get('boss') ||
        flags.get('fight') ||
        flags.get('任务') ||
        flags.get('高难') ||
        flags.get('高难任务'),
    );
    let zoneId = this.normalizeString(
      flags.get('zone') ||
        flags.get('zoneId') ||
        flags.get('区域') ||
        flags.get('副本区域'),
    );
    const dungeonFlag = this.normalizeString(flags.get('副本'));
    if (dungeonFlag) {
      if (/^\d+$/.test(dungeonFlag)) {
        zoneId = zoneId || dungeonFlag;
      } else {
        encounterName = encounterName || dungeonFlag;
      }
    }
    let remainingPositionals = [...positional];

    if (!characterName && remainingPositionals[0]?.includes('@')) {
      const [name, server] = remainingPositionals[0].split('@');
      characterName = name.trim();
      serverSlug = serverSlug || server?.trim();
      if (!encounterName && remainingPositionals.length > 1) {
        encounterName = remainingPositionals.slice(1).join(' ');
      }
      remainingPositionals = [];
    }

    if (!encounterName && remainingPositionals.length > 2) {
      const picked =
        await this.pickFflogsPositionalsByKnownWorld(remainingPositionals);
      if (picked) {
        characterName = characterName || picked.characterName;
        serverSlug = serverSlug || picked.serverSlug;
        encounterName = picked.encounterName;
        remainingPositionals = [];
      }
    }

    if (!characterName && remainingPositionals.length) {
      const joined = remainingPositionals.join(' ');
      if (joined.includes('@')) {
        const [name, server] = joined.split('@');
        characterName = name.trim();
        serverSlug = serverSlug || server?.trim();
      } else if (serverSlug) {
        characterName = joined;
      } else if (remainingPositionals.length > 1) {
        serverSlug = remainingPositionals[remainingPositionals.length - 1];
        characterName = remainingPositionals.slice(0, -1).join(' ');
      } else {
        characterName = joined;
      }
    }

    return {
      characterName,
      className: this.normalizeString(flags.get('class') || flags.get('职业')),
      difficulty: this.normalizeString(
        flags.get('difficulty') || flags.get('难度'),
      ),
      encounter: encounterName,
      encounterName,
      metric: this.normalizeString(flags.get('metric') || flags.get('指标')),
      partition: this.normalizeString(
        flags.get('partition') || flags.get('分区'),
      ),
      limit: this.normalizeString(flags.get('limit') || flags.get('数量')),
      raw: rawArgs,
      role: this.normalizeString(flags.get('role') || flags.get('职责')),
      serverRegion: this.normalizeString(
        flags.get('region') ||
          flags.get('serverRegion') ||
          flags.get('地区') ||
          flags.get('服务器地区'),
      ),
      serverSlug,
      size: this.normalizeString(flags.get('size') || flags.get('人数')),
      specName: this.normalizeString(flags.get('spec') || flags.get('专精')),
      text: rawArgs,
      timeframe: this.normalizeString(
        flags.get('timeframe') || flags.get('时间') || flags.get('范围'),
      ),
      zoneId,
    };
  }

  private pickTrailingFf14Location(
    catalog: QqbotFf14MarketCatalog,
    positional: string[],
  ) {
    const last = positional[positional.length - 1];
    if (!isQqbotFf14LocationName(catalog, last)) return null;

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
      isQqbotFf14DataCenterName(catalog, previous) &&
      isQqbotFf14WorldName(catalog, last)
    ) {
      const hasRegion =
        beforePrevious && isQqbotFf14RegionName(catalog, beforePrevious);
      return {
        dataCenter: previous,
        item: positional.slice(0, hasRegion ? -3 : -2).join(' '),
        region: hasRegion ? beforePrevious : undefined,
        world: last,
      };
    }

    if (
      previous &&
      isQqbotFf14RegionName(catalog, previous) &&
      isQqbotFf14DataCenterName(catalog, last)
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

  private async pickFflogsPositionalsByKnownWorld(positional: string[]) {
    const catalog = await this.getFf14MarketCatalog();
    for (let index = positional.length - 2; index > 0; index--) {
      const candidate = positional[index];
      if (!isQqbotFf14LocationName(catalog, candidate)) continue;
      const characterName = positional.slice(0, index).join(' ').trim();
      const encounterName = positional
        .slice(index + 1)
        .join(' ')
        .trim();
      if (!characterName || !encounterName) continue;
      const worldPath = splitQqbotFf14WorldPath(candidate);
      return {
        characterName,
        encounterName,
        serverSlug: worldPath.world || candidate,
      };
    }
    return null;
  }

  private async getFf14MarketCatalog() {
    const treeCatalog = buildQqbotFf14MarketCatalogFromTree(
      await this.dictService.relationTree({
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.region),
      this.dictService.getDictItemsByKey(
        QQBOT_FF14_MARKET_DICT_CODES.dataCenter,
      ),
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildQqbotFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
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
