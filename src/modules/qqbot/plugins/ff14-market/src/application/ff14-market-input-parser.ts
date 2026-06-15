import type { QqbotFf14MarketCatalog } from '../domain/ff14-market.types';
import {
  isQqbotFf14DataCenterName,
  isQqbotFf14LocationName,
  isQqbotFf14RegionName,
  isQqbotFf14WorldName,
  splitQqbotFf14WorldPath,
} from '../domain/ff14-worlds';

export type QqbotFf14MarketPriceInput = {
  dataCenter?: string;
  hq?: boolean;
  item?: string;
  language?: string;
  raw: string;
  region?: string;
  world?: string;
};

export function parseQqbotFf14MarketPriceInput(
  rawArgs: string,
  catalog: QqbotFf14MarketCatalog,
): QqbotFf14MarketPriceInput {
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

  let region = normalizeString(flags.get('region') || flags.get('地区'));
  let dataCenter = normalizeString(
    flags.get('dataCenter') ||
      flags.get('datacenter') ||
      flags.get('dc') ||
      flags.get('大区'),
  );
  let world = normalizeString(
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
    const picked = pickTrailingFf14Location(catalog, positional);
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
    hq: normalizeHq(flags.get('hq')),
    item,
    language: normalizeString(flags.get('lang')) || 'chs',
    raw: rawArgs,
    region,
    world,
  };
}

function pickTrailingFf14Location(
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

function normalizeHq(value?: string | true) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === 'false') return false;
  return ['1', 'true', 'yes', 'hq'].includes(`${value}`.toLowerCase());
}

function normalizeString(value?: string | true) {
  if (value === true) return '';
  return `${value || ''}`.trim();
}
