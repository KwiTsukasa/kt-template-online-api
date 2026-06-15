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
        region:
          normalizeFf14WorldValue(item.childrenCode) || defaultRegion,
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

export function isFf14DataCenterName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.name === name);
}

export function isFf14RegionName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  return catalog.regions.includes(name);
}

export function isFf14WorldName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  return catalog.dataCenters.some((item) => item.worlds.includes(name));
}

export function isFf14LocationName(
  catalog: Ff14MarketCatalog,
  value?: string,
) {
  const name = normalizeFf14WorldValue(value);
  const path = splitFf14WorldPath(name);
  return (
    isFf14RegionName(catalog, name) ||
    isFf14DataCenterName(catalog, name) ||
    isFf14WorldName(catalog, name) ||
    (!!path.dataCenter && !!path.world)
  );
}

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

export function findFf14DataCenterByWorld(
  catalog: Ff14MarketCatalog,
  world?: string,
) {
  const worldName = normalizeFf14WorldValue(world);
  return catalog.dataCenters.find((item) => item.worlds.includes(worldName));
}

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

function getDictDisplayValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.label || item.value);
}

function getDictRawValue(item: Ff14DictItem) {
  return normalizeFf14WorldValue(item.value || item.label);
}

function normalizeFf14WorldValue(value?: string | null) {
  return `${value || ''}`.trim();
}
