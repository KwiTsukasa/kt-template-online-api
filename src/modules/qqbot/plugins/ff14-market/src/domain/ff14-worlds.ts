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
 * 根据`input`构造针对FF14 市场插件。
 * @param input - 用于针对FF14 市场插件的结构化输入，包含 `regions`、`dataCenters`、`worlds` 字段。
 * @returns 包含 `dataCenters`、`defaultRegion`、`regions` 字段的针对FF14 市场插件。
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
 * 根据`roots`构造针对FF14 市场插件。
 * @param roots - 决定针对FF14 市场插件内容、边界或目标的 `roots` 值。
 * @returns 包含 `dataCenters`、`defaultRegion`、`regions` 字段的针对FF14 市场插件。
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
 * 根据`catalog`、`value`与当前约束判定针对FF14 市场插件。
 * @param catalog - 用于针对FF14 市场插件的领域对象，包含 `dataCenters` 字段。
 * @param value - 待判定是否满足针对FF14 市场插件约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isFf14DataCenterName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.name === name);
}

/**
 * 根据`catalog`、`value`与当前约束判定针对FF14 市场插件。
 * @param catalog - 用于针对FF14 市场插件的领域对象，包含 `regions` 字段。
 * @param value - 待判定是否满足针对FF14 市场插件约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isFf14RegionName(catalog: Ff14MarketCatalog, value?: string) {
  const name = normalizeFf14WorldValue(value);
  return catalog.regions.includes(name);
}

/**
 * 根据`catalog`、`value`与当前约束判定针对FF14 市场插件。
 * @param catalog - 用于针对FF14 市场插件的领域对象，包含 `dataCenters` 字段。
 * @param value - 待判定是否满足针对FF14 市场插件约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isFf14WorldName(catalog: Ff14MarketCatalog, value?: string) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.worlds.includes(name));
}

/**
 * 根据`catalog`、`value`与当前约束判定针对FF14 市场插件。
 * @param catalog - 决定针对FF14 市场插件内容、边界或目标的 `catalog` 值。
 * @param value - 待判定是否满足针对FF14 市场插件约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 根据`value`拼接稳定的针对FF14 市场插件，用于隔离对应资源或存储记录；当 `parts.length === 2` 成立时返回 `{ dataCenter: parts[0], world: parts[1], }`。
 * @param value - 参与针对FF14 市场插件比较、格式化或输出的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `dataCenter`、`region`、`world` 字段的针对FF14 市场插件。
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
 * 按`catalog`、`world`读取针对FF14 市场插件。
 * @param catalog - 用于针对FF14 市场插件的领域对象，包含 `dataCenters` 字段。
 * @param world - 决定针对FF14 市场插件内容、边界或目标的 `world` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 针对FF14 市场插件。
 */
export function findFf14DataCenterByWorld(
  catalog: Ff14MarketCatalog,
  world?: string,
) {
  const worldName = normalizeFf14WorldValue(world);
  return catalog.dataCenters.find((item) => item.worlds.includes(worldName));
}

/**
 * 从`catalog`、`params`解析Ff14市场数据Target；当 `region && dataCenter && (!world || world === region)` 成立时返回 `{ dataCenter, label: `${region} / ${dataCen…`。
 * @param catalog - 用于Ff14市场数据Target的领域对象，包含 `defaultRegion`、`dataCenters` 字段。
 * @param params - 用于Ff14市场数据Target的领域对象，包含 `fallback`、`world`、`region`、`dataCenter` 字段。
 * @returns 包含 `label`、`target` 字段的Ff14市场数据Target。
 * @throws 当 `matchedDataCenter && !matchedDataCenter.worlds.includes(world)` 成立时拒绝当前输入并抛出 `Error`。
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
  const world = (() => {
    if (dataCenter && rawWorld === defaultRegion) {
      return '';
    }
    return rawWorld;
  })();
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
      label: (() => {
        if (region) {
          return `${region} / ${dataCenter} / ${world}`;
        }
        return `${dataCenter} / ${world}`;
      })(),
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
      label: (() => {
        if (defaultRegion) {
          return `${defaultRegion} / ${raw}`;
        }
        return raw;
      })(),
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
 * 按`item`读取针对FF14 市场插件。
 * @param item - 用于针对FF14 市场插件的领域对象，包含 `label`、`value` 字段。
 * @returns 针对FF14 市场插件。
 */
function getDictDisplayValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.label || item.value);
}

/**
 * 按`item`读取针对FF14 市场插件。
 * @param item - 用于针对FF14 市场插件的领域对象，包含 `value`、`label` 字段。
 * @returns 针对FF14 市场插件。
 */
function getDictRawValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.value || item.label);
}

/**
 * 将`value`规范为针对FF14 市场插件，使等价输入得到一致表示。
 * @param value - 待转换为针对FF14 市场插件的原始值；为空时采用 `''` 作为兜底。
 * @returns 针对FF14 市场插件。
 */
function normalizeFf14WorldValue(value?: string | null) {
  return `${value || ''}`.trim();
}
