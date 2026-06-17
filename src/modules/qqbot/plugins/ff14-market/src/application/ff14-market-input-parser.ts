import type { Ff14MarketCatalog } from '../domain/ff14-market.types';
import {
  isFf14DataCenterName,
  isFf14LocationName,
  isFf14RegionName,
  isFf14WorldName,
  splitFf14WorldPath,
} from '../domain/ff14-worlds';

export type Ff14MarketPriceInput = {
  dataCenter?: string;
  hq?: boolean;
  item?: string;
  language?: string;
  raw: string;
  region?: string;
  world?: string;
};

/**
 * 解析Ff14 Market Price Input。
 * @param rawArgs - FF14 市场列表；生成规范化文本。
 * @param catalog - catalog 输入；驱动 `pickTrailingFf14Location()` 的 FF14 市场步骤。
 * @returns FF14 市场插件转换后的值。
 */
export function parseFf14MarketPriceInput(
  rawArgs: string,
  catalog: Ff14MarketCatalog,
): Ff14MarketPriceInput {
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

  const worldPath = splitFf14WorldPath(world);
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
    const itemWorldPath = splitFf14WorldPath(worldName);
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

/**
 * 执行 FF14 市场插件流程。
 * @param catalog - catalog 输入；驱动 `isFf14RegionName()` 的 FF14 市场步骤。
 * @param positional - positional 输入；使用 `length` 字段生成结果。
 */
function pickTrailingFf14Location(
  catalog: Ff14MarketCatalog,
  positional: string[],
) {
  const last = positional[positional.length - 1];
  if (!isFf14LocationName(catalog, last)) return null;

  const path = splitFf14WorldPath(last);
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
    isFf14DataCenterName(catalog, previous) &&
    isFf14WorldName(catalog, last)
  ) {
    const hasRegion =
      beforePrevious && isFf14RegionName(catalog, beforePrevious);
    return {
      dataCenter: previous,
      item: positional.slice(0, hasRegion ? -3 : -2).join(' '),
      region: hasRegion ? beforePrevious : undefined,
      world: last,
    };
  }

  if (
    previous &&
    isFf14RegionName(catalog, previous) &&
    isFf14DataCenterName(catalog, last)
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

/**
 * 转换 FF14 市场插件输入。
 * @param value - 待转换值；决定 FF14 市场条件分支。
 */
function normalizeHq(value?: string | true) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === 'false') return false;
  return ['1', 'true', 'yes', 'hq'].includes(`${value}`.toLowerCase());
}

/**
 * 转换 FF14 市场插件输入。
 * @param value - 待转换值；决定 FF14 市场条件分支。
 */
function normalizeString(value?: string | true) {
  if (value === true) return '';
  return `${value || ''}`.trim();
}
