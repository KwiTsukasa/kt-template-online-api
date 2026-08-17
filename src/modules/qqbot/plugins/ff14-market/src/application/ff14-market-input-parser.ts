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
 * 通过 `filter` 筛选匹配数据。
 * @param rawArgs - 决定Ff14市场数据Price输入内容、边界或目标的 `rawArgs` 值。
 * @param catalog - 决定Ff14市场数据Price输入内容、边界或目标的 `catalog` 值。
 * @returns 包含 `dataCenter`、`hq`、`item`、`language`、`raw` 字段的Ff14市场数据Price输入。
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
 * 从`catalog`、`positional`筛选针对FF14 市场插件，并保持保留项的原有顺序与键名；当 `path.dataCenter && path.world` 成立时返回 `{ dataCenter: path.dataCenter, item: positi…`。
 * @param catalog - 决定针对FF14 市场插件内容、边界或目标的 `catalog` 值。
 * @param positional - 用于针对FF14 市场插件的领域对象，包含 `positional.length - 1`、`length`、`positional.length - 2` 字段。
 * @returns 包含 `item`、`world` 字段的针对FF14 市场插件；无法解析或未命中时为 `null`。
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
      item: positional.slice(0, (() => {
        if (hasRegion) {
          return -3;
        }
        return -2;
      })()).join(' '),
      region: (() => {
        if (hasRegion) {
          return beforePrevious;
        }
        return undefined;
      })(),
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
 * 将`value`规范为针对FF14 市场插件，使等价输入得到一致表示。
 * @param value - 待转换为针对FF14 市场插件的原始值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
 */
function normalizeHq(value?: string | true) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === 'false') return false;
  return ['1', 'true', 'yes', 'hq'].includes(`${value}`.toLowerCase());
}

/**
 * 将`value`规范为针对FF14 市场插件，使等价输入得到一致表示。
 * @param value - 待转换为针对FF14 市场插件的原始值；为空时采用 `''` 作为兜底。
 * @returns 当前状态对应的针对FF14 市场插件，取值为 `''`。
 */
function normalizeString(value?: string | true) {
  if (value === true) return '';
  return `${value || ''}`.trim();
}
