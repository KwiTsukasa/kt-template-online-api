export type QqbotFf14DataCenter = {
  name: string;
  region: string;
  worlds: string[];
};

export type QqbotFf14MarketTarget = {
  dataCenter?: string;
  label: string;
  region?: string;
  target: string;
  world?: string;
};

export const QQBOT_FF14_DEFAULT_REGION = '中国';

export const QQBOT_FF14_CHINA_DATA_CENTERS: QqbotFf14DataCenter[] = [
  {
    name: '陆行鸟',
    region: QQBOT_FF14_DEFAULT_REGION,
    worlds: [
      '红玉海',
      '神意之地',
      '拉诺西亚',
      '幻影群岛',
      '萌芽池',
      '宇宙和音',
      '沃仙曦染',
      '晨曦王座',
    ],
  },
  {
    name: '莫古力',
    region: QQBOT_FF14_DEFAULT_REGION,
    worlds: [
      '白银乡',
      '白金幻象',
      '神拳痕',
      '潮风亭',
      '旅人栈桥',
      '拂晓之间',
      '龙巢神殿',
      '梦羽宝境',
    ],
  },
  {
    name: '猫小胖',
    region: QQBOT_FF14_DEFAULT_REGION,
    worlds: [
      '紫水栈桥',
      '延夏',
      '静语庄园',
      '摩杜纳',
      '海猫茶屋',
      '柔风海湾',
      '琥珀原',
    ],
  },
  {
    name: '豆豆柴',
    region: QQBOT_FF14_DEFAULT_REGION,
    worlds: ['水晶塔', '银泪湖', '太阳海岸', '伊修加德', '红茶川'],
  },
];

export function isQqbotFf14DataCenterName(value?: string) {
  const name = normalizeQqbotFf14WorldValue(value);
  return QQBOT_FF14_CHINA_DATA_CENTERS.some((item) => item.name === name);
}

export function isQqbotFf14RegionName(value?: string) {
  return normalizeQqbotFf14WorldValue(value) === QQBOT_FF14_DEFAULT_REGION;
}

export function isQqbotFf14WorldName(value?: string) {
  const name = normalizeQqbotFf14WorldValue(value);
  return QQBOT_FF14_CHINA_DATA_CENTERS.some((item) =>
    item.worlds.includes(name),
  );
}

export function isQqbotFf14LocationName(value?: string) {
  const name = normalizeQqbotFf14WorldValue(value);
  const path = splitQqbotFf14WorldPath(name);
  return (
    isQqbotFf14RegionName(name) ||
    isQqbotFf14DataCenterName(name) ||
    isQqbotFf14WorldName(name) ||
    (!!path.dataCenter && !!path.world)
  );
}

export function splitQqbotFf14WorldPath(value?: string) {
  const raw = normalizeQqbotFf14WorldValue(value);
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

export function findQqbotFf14DataCenterByWorld(world?: string) {
  const worldName = normalizeQqbotFf14WorldValue(world);
  return QQBOT_FF14_CHINA_DATA_CENTERS.find((item) =>
    item.worlds.includes(worldName),
  );
}

export function resolveQqbotFf14MarketTarget(params: {
  dataCenter?: string;
  fallback?: string;
  region?: string;
  world?: string;
}): QqbotFf14MarketTarget {
  const fallback = normalizeQqbotFf14WorldValue(params.fallback);
  const path = splitQqbotFf14WorldPath(params.world);
  const region = normalizeQqbotFf14WorldValue(params.region || path.region);
  const dataCenter = normalizeQqbotFf14WorldValue(
    params.dataCenter || path.dataCenter,
  );
  const rawWorld = normalizeQqbotFf14WorldValue(path.world || params.world);
  const world =
    dataCenter && rawWorld === QQBOT_FF14_DEFAULT_REGION ? '' : rawWorld;
  const raw =
    world || dataCenter || region || fallback || QQBOT_FF14_DEFAULT_REGION;

  if (region && dataCenter && (!world || world === region)) {
    return {
      dataCenter,
      label: `${region} / ${dataCenter}`,
      region,
      target: dataCenter,
    };
  }

  if (raw === QQBOT_FF14_DEFAULT_REGION) {
    return {
      label: QQBOT_FF14_DEFAULT_REGION,
      region: QQBOT_FF14_DEFAULT_REGION,
      target: QQBOT_FF14_DEFAULT_REGION,
    };
  }

  if (dataCenter && world && world !== dataCenter) {
    const matchedDataCenter = QQBOT_FF14_CHINA_DATA_CENTERS.find(
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

  const matchedWorldDataCenter = findQqbotFf14DataCenterByWorld(raw);
  if (matchedWorldDataCenter) {
    return {
      dataCenter: matchedWorldDataCenter.name,
      label: `${matchedWorldDataCenter.region} / ${matchedWorldDataCenter.name} / ${raw}`,
      region: matchedWorldDataCenter.region,
      target: raw,
      world: raw,
    };
  }

  if (isQqbotFf14DataCenterName(raw)) {
    return {
      dataCenter: raw,
      label: `${QQBOT_FF14_DEFAULT_REGION} / ${raw}`,
      region: QQBOT_FF14_DEFAULT_REGION,
      target: raw,
    };
  }

  return {
    label: raw,
    target: raw,
  };
}

function normalizeQqbotFf14WorldValue(value?: string) {
  return `${value || ''}`.trim();
}
