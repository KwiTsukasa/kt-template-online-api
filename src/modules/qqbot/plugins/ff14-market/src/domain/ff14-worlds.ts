import type {
  Ff14DataCenter,
  Ff14MarketCatalog,
  Ff14MarketTarget,
} from './ff14-market.types';

export type Ff14DictItem = {
  children?: Ff14DictItem[];
  childrenCode?: string;
  dictCode?: string;
  id?: string;
  label?: string;
  sort?: number;
  status?: number | string;
  treeKey?: string;
  value?: string;
};

export const QQBOT_FF14_MARKET_DICT_CODES = {
  dataCenter: 'FF14_MARKET_DATA_CENTER',
  region: 'FF14_MARKET_REGION',
  world: 'FF14_MARKET_WORLD',
};

/**
 * 创建 FF14 市场插件对象或配置。
 * @param input - input 输入；使用 `regions`、`dataCenters`、`worlds` 字段生成结果。
 * @returns 创建后的 FF14 市场插件对象或配置。
 */
export function buildFf14MarketCatalog(input: {
  dataCenters: Ff14DictItem[];
  regions: Ff14DictItem[];
  worlds: Ff14DictItem[];
}): Ff14MarketCatalog {
  const regions = input.regions.map(getDictDisplayValue).filter(Boolean);
  const defaultRegion = regions[0];
  const dataCenters = input.dataCenters
    .map((item) => {
      const name = getDictDisplayValue(item);
      if (!name) return null;
      return {
        name,
        region: normalizeFf14WorldValue(item.childrenCode) || defaultRegion,
        worlds: input.worlds
          .filter(({ childrenCode }) => childrenCode === getDictRawValue(item))
          .map(getDictDisplayValue)
          .filter(Boolean),
      };
    })
    .filter((item): item is Ff14DataCenter => !!item);

  return {
    dataCenters,
    defaultRegion,
    regions,
  };
}

/**
 * 创建 FF14 市场插件对象或配置。
 * @param roots - FF14 市场列表；筛选 FF14 市场列表项。
 * @returns 创建后的 FF14 市场插件对象或配置。
 */
export function buildFf14MarketCatalogFromTree(
  roots: Ff14DictItem[],
): Ff14MarketCatalog {
  const regionNodes = roots.filter(
    (item) => item.dictCode === QQBOT_FF14_MARKET_DICT_CODES.region,
  );
  const regions = regionNodes.map(getDictDisplayValue).filter(Boolean);
  const defaultRegion = regions[0];
  const dataCenters = regionNodes.flatMap((regionNode) => {
    const region = getDictDisplayValue(regionNode) || defaultRegion || '';

    return (regionNode.children || [])
      .map((dataCenterNode) => {
        const name = getDictDisplayValue(dataCenterNode);
        if (!name) return null;

        return {
          name,
          region,
          worlds: (dataCenterNode.children || [])
            .map(getDictDisplayValue)
            .filter(Boolean),
        };
      })
      .filter((item): item is Ff14DataCenter => !!item);
  });

  return {
    dataCenters,
    defaultRegion,
    regions,
  };
}

/**
 * 判断 FF14 市场插件条件。
 * @param catalog - catalog 输入；使用 `dataCenters` 字段计算判断结果。
 * @param value - 待转换值；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function isFf14DataCenterName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.name === name);
}

/**
 * 判断 FF14 市场插件条件。
 * @param catalog - catalog 输入；使用 `regions` 字段计算判断结果。
 * @param value - 待转换值；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function isFf14RegionName(catalog: Ff14MarketCatalog, value?: string) {
  const name = normalizeFf14WorldValue(value);
  return catalog.regions.includes(name);
}

/**
 * 判断 FF14 市场插件条件。
 * @param catalog - catalog 输入；使用 `dataCenters` 字段计算判断结果。
 * @param value - 待转换值；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function isFf14WorldName(catalog: Ff14MarketCatalog, value?: string) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.worlds.includes(name));
}

/**
 * 判断 FF14 市场插件条件。
 * @param catalog - catalog 输入；计算 FF14 市场判断结果。
 * @param value - 待转换值；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function isFf14LocationName(catalog: Ff14MarketCatalog, value?: string) {
  const name = normalizeFf14WorldValue(value);
  const path = splitFf14WorldPath(name);
  return (
    isFf14RegionName(catalog, name) ||
    isFf14DataCenterName(catalog, name) ||
    isFf14WorldName(catalog, name) ||
    (!!path.dataCenter && !!path.world)
  );
}

/**
 * 执行 FF14 市场插件流程。
 * @param value - 待转换值；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function splitFf14WorldPath(value?: string) {
  const raw = normalizeFf14WorldValue(value);
  if (!raw) return {};

  const parts = raw
    .split(/\s*(?:->|=>|>|\/|\\|：|:)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return {};

  if (parts.length === 2) {
    return {
      dataCenter: parts[0],
      world: parts[1],
    };
  }

  return {
    dataCenter: parts[parts.length - 2],
    region: parts[0],
    world: parts[parts.length - 1],
  };
}

/**
 * 查询 FF14 市场插件数据。
 * @param catalog - catalog 输入；使用 `dataCenters` 字段生成结果。
 * @param world - world 输入；驱动 `normalizeFf14WorldValue()` 的 FF14 市场步骤。
 */
export function findFf14DataCenterByWorld(
  catalog: Ff14MarketCatalog,
  world?: string,
) {
  const worldName = normalizeFf14WorldValue(world);
  return catalog.dataCenters.find((item) => item.worlds.includes(worldName));
}

/**
 * 解析Ff14 Market Target。
 * @param catalog - catalog 输入；使用 `defaultRegion`、`dataCenters` 字段生成结果。
 * @param params - FF14 市场列表；使用 `fallback`、`world`、`region`、`dataCenter` 字段生成结果。
 * @returns FF14 市场插件转换后的值。
 */
export function resolveFf14MarketTarget(
  catalog: Ff14MarketCatalog,
  params: {
    dataCenter?: string;
    fallback?: string;
    region?: string;
    world?: string;
  },
): Ff14MarketTarget {
  const defaultRegion = catalog.defaultRegion || '';
  const fallback = normalizeFf14WorldValue(params.fallback);
  const path = splitFf14WorldPath(params.world);
  const region = normalizeFf14WorldValue(params.region || path.region);
  const dataCenter = normalizeFf14WorldValue(
    params.dataCenter || path.dataCenter,
  );
  const rawWorld = normalizeFf14WorldValue(path.world || params.world);
  const world = dataCenter && rawWorld === defaultRegion ? '' : rawWorld;
  const raw = world || dataCenter || region || fallback || defaultRegion;

  if (region && dataCenter && (!world || world === region)) {
    return {
      dataCenter,
      label: `${region} / ${dataCenter}`,
      region,
      target: dataCenter,
    };
  }

  if (raw && raw === defaultRegion) {
    return {
      label: defaultRegion,
      region: defaultRegion,
      target: defaultRegion,
    };
  }

  if (dataCenter && world && world !== dataCenter) {
    const matchedDataCenter = catalog.dataCenters.find(
      (item) => item.name === dataCenter,
    );
    if (matchedDataCenter && !matchedDataCenter.worlds.includes(world)) {
      throw new Error(`服务器 ${world} 不属于大区 ${dataCenter}`);
    }
    return {
      dataCenter,
      label: region
        ? `${region} / ${dataCenter} / ${world}`
        : `${dataCenter} / ${world}`,
      region,
      target: world,
      world,
    };
  }

  const matchedWorldDataCenter = findFf14DataCenterByWorld(catalog, raw);
  if (matchedWorldDataCenter) {
    return {
      dataCenter: matchedWorldDataCenter.name,
      label: `${matchedWorldDataCenter.region} / ${matchedWorldDataCenter.name} / ${raw}`,
      region: matchedWorldDataCenter.region,
      target: raw,
      world: raw,
    };
  }

  if (isFf14DataCenterName(catalog, raw)) {
    return {
      dataCenter: raw,
      label: defaultRegion ? `${defaultRegion} / ${raw}` : raw,
      region: defaultRegion,
      target: raw,
    };
  }

  return {
    label: raw,
    target: raw,
  };
}

/**
 * 查询 FF14 市场插件数据。
 * @param item - item 输入；使用 `label`、`value` 字段生成结果。
 */
function getDictDisplayValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.label || item.value);
}

/**
 * 查询 FF14 市场插件数据。
 * @param item - item 输入；使用 `value`、`label` 字段生成结果。
 */
function getDictRawValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.value || item.label);
}

/**
 * 转换 FF14 市场插件输入。
 * @param value - 待转换值；影响 normalizeFf14WorldValue 的返回值。
 */
function normalizeFf14WorldValue(value?: string | null) {
  return `${value || ''}`.trim();
}
