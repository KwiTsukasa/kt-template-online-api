export enum ComponentTypeEnum {
  CHART = 1,
  COMPONENT = 2,
}

export enum ComponentEnum {
  NOT_CATEGORY = -1,
  LINE = 1,
  BAR = 2,
  PIE = 3,
  SCATTER = 4,
  MAP = 5,
  CANDLESTICK = 6,
  RADAR = 7,
  BOX_PLOT = 8,
  HEATMAP = 9,
  GRAPH = 10,
  LINES = 11,
  TREE = 12,
  TREE_MAP = 13,
  SUNBURST = 14,
  PARALLEL = 15,
  SAN_KEY = 16,
  FUNNEL = 17,
  GAUGE = 18,
  PICTORIAL_BAR = 19,
  THEME_RIVER = 20,
  LIQUID_FILL = 21,
  WORD_CLOUD = 22,
  TABLE = 23,
  FORM = 24,
  CONTAINER = 25,
}

export enum DictKeyEnum {
  COMPONENT_TYPE = 'COMPONENT_TYPE',
  CHART = 'CHART',
  COMPONENT = 'COMPONENT',
}

export type DictKeyType = keyof typeof DictKeyEnum;

export const DictKeyMap: Map<DictKeyType, Dict[]> = new Map();

const ComponentTypeDict = [
  {
    label: '图表',
    value: 1,
  },
  {
    label: '组件',
    value: 2,
  },
];

const ChartDict = [
  {
    label: '未分类',
    value: -1,
  },
  {
    label: '折线图',
    value: 1,
  },
  {
    label: '柱状图',
    value: 2,
  },
  {
    label: '饼图',
    value: 3,
  },
  {
    label: '散点图',
    value: 4,
  },
  {
    label: '地图',
    value: 5,
  },
  {
    label: 'K线图',
    value: 6,
  },
  {
    label: '雷达图',
    value: 7,
  },
  {
    label: '盒须图',
    value: 8,
  },
  {
    label: '热力图',
    value: 9,
  },
  {
    label: '关系图',
    value: 10,
  },
  {
    label: '路径图',
    value: 11,
  },
  {
    label: '树图',
    value: 12,
  },
  {
    label: '矩树图',
    value: 13,
  },
  {
    label: '旭日图',
    value: 14,
  },
  {
    label: '平行坐标系',
    value: 15,
  },
  {
    label: '桑基图',
    value: 16,
  },
  {
    label: '漏斗图',
    value: 17,
  },
  {
    label: '仪表盘',
    value: 18,
  },
  {
    label: '象形图',
    value: 19,
  },
  {
    label: '河流图',
    value: 20,
  },
  {
    label: '水球',
    value: 21,
  },
  {
    label: '词云',
    value: 22,
  },
];

const ComponentDict = [
  {
    label: '未分类',
    value: -1,
  },
  {
    label: '表格',
    value: 23,
  },
  {
    label: '表单',
    value: 24,
  },
  {
    label: '容器',
    value: 25,
  },
];

DictKeyMap.set(DictKeyEnum.COMPONENT_TYPE, ComponentTypeDict);
DictKeyMap.set(DictKeyEnum.CHART, ChartDict);
DictKeyMap.set(DictKeyEnum.COMPONENT, ComponentDict);
