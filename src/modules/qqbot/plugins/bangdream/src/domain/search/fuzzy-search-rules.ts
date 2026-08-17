import {
  isValidRelationStr,
  normalizeRelationKeyword,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/relation-matcher';
import type {
  FuzzySearchConfig,
  FuzzySearchConfigValue,
  FuzzySearchMatchValue,
  FuzzySearchResultWriter,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';

const INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

export interface FuzzySearchKeyword {
  lowerKeyword: string;
  normalizedKeyword: string;
  rawKeyword: string;
}

export interface FuzzySearchRule {
  name: string;
  canHandle: (keyword: FuzzySearchKeyword) => boolean;
  match: (keyword: FuzzySearchKeyword, push: FuzzySearchResultWriter) => void;
}

export class FuzzySearchRules {
  constructor(private readonly rules: readonly FuzzySearchRule[]) {}

  /**
   * 按注册顺序匹配并执行第一条可处理规则。
   * @param keyword - 决定按注册顺序匹配并执行第一条可处理规则内容、边界或目标的 `keyword` 值。
   * @param push - 决定按注册顺序匹配并执行第一条可处理规则内容、边界或目标的 `push` 值。
   * @returns 满足按注册顺序匹配并执行第一条可处理规则约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  match(keyword: FuzzySearchKeyword, push: FuzzySearchResultWriter): boolean {
    const rule = this.rules.find((item) => item.canHandle(keyword));
    if (!rule) return false;
    rule.match(keyword, push);
    return true;
  }
}

/**
 * 创建结构化关键词，供规则判断和写入使用。
 * @param rawKeyword - 决定结构化关键词，供规则判断和写入使用内容、边界或目标的 `rawKeyword` 值。
 * @returns 包含 `lowerKeyword`、`normalizedKeyword`、`rawKeyword` 字段的结构化关键词，供规则判断和写入使用。
 */
export function createFuzzySearchKeyword(
  rawKeyword: string,
): FuzzySearchKeyword {
  const lowerKeyword = rawKeyword.toLowerCase();
  return {
    lowerKeyword,
    normalizedKeyword: normalizeRelationKeyword(lowerKeyword),
    rawKeyword,
  };
}

/**
 * 根据`config`构造默认模糊搜索规则注册表。
 * @param config - 限定默认模糊搜索规则注册表边界、地址与开关的运行配置。
 * @returns 完成初始化并携带当前边界配置的默认模糊搜索规则注册表。
 */
export function createDefaultFuzzySearchRules(config: FuzzySearchConfig) {
  return new FuzzySearchRules([
    createNumberRule(),
    createLevelRule(),
    createRelationRule(),
    createConfigRule(config),
    createFallbackRule(),
  ]);
}

/**
 * 根据当前运行态构造包含 `canHandle`、`match`、`name` 字段的结果。
 * @returns 包含 `canHandle`、`match`、`name` 字段的包含 `canHandle`、`match`、`name` 字段的。
 */
function createNumberRule(): FuzzySearchRule {
  return {
    canHandle: ({ lowerKeyword }) => isInteger(lowerKeyword),
    match: ({ lowerKeyword }, push) =>
      push('_number')(parseInt(lowerKeyword, 10)),
    name: 'number',
  };
}

/**
 * 根据当前运行态构造包含 `canHandle`、`match`、`name` 字段的结果。
 * @returns 包含 `canHandle`、`match`、`name` 字段的包含 `canHandle`、`match`、`name` 字段的；无法解析或未命中时为 `null`。
 */
function createLevelRule(): FuzzySearchRule {
  return {
    canHandle: ({ normalizedKeyword }) =>
      extractLvNumber(normalizedKeyword) !== null,
    match: ({ normalizedKeyword }, push) =>
      push('songLevels')(extractLvNumber(normalizedKeyword) ?? 0),
    name: 'level',
  };
}

/**
 * 根据当前运行态构造包含 `canHandle`、`match`、`name` 字段的结果。
 * @returns 包含 `canHandle`、`match`、`name` 字段的包含 `canHandle`、`match`、`name` 字段的。
 */
function createRelationRule(): FuzzySearchRule {
  return {
    canHandle: ({ normalizedKeyword }) => isValidRelationStr(normalizedKeyword),
    match: ({ normalizedKeyword }, push) =>
      push('_relationStr')(normalizedKeyword),
    name: 'relation',
  };
}

/**
 * 根据`config`构造包含 `canHandle`、`match`、`name` 字段的结果。
 * @param config - 限定包含 `canHandle`、`match`、`name` 字段的结果边界、地址与开关的运行配置。
 * @returns 包含 `canHandle`、`match`、`name` 字段的包含 `canHandle`、`match`、`name` 字段的。
 */
function createConfigRule(config: FuzzySearchConfig): FuzzySearchRule {
  return {
    canHandle: ({ normalizedKeyword }) =>
      collectConfigMatches(config, normalizedKeyword).length > 0,
    match: ({ normalizedKeyword }, push) => {
      for (const item of collectConfigMatches(config, normalizedKeyword)) {
        push(item.type)(item.value);
      }
    },
    name: 'config',
  };
}

/**
 * 根据当前运行态构造包含 `canHandle`、`match`、`name` 字段的结果。
 * @returns 包含 `canHandle`、`match`、`name` 字段的包含 `canHandle`、`match`、`name` 字段的。
 */
function createFallbackRule(): FuzzySearchRule {
  return {
    canHandle: () => true,
    match: ({ rawKeyword }, push) => push('_all')(rawKeyword),
    name: 'fallback',
  };
}

/**
 * 从等级关键词中提取数字等级。
 * @param str - 用于从等级关键词中提取数字等级的领域对象，包含 `match` 字段。
 * @returns 从等级关键词中提取数字等级；无法解析或未命中时为 `null`。
 */
function extractLvNumber(str: string): number | null {
  const match = str.match(/^lv(\d+)$/i);
  if (match?.[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * 根据`value`与当前约束判定字符串是否为非负整数。
 * @param value - 待判定是否满足字符串是否为非负整数约束的候选值。
 * @returns 满足字符串是否为非负整数约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isInteger(value: string): boolean {
  return INTEGER_PATTERN.test(value);
}

const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 把配置键转换成数字或字符串匹配值。
 * @param key - 用于读取或更新把配置键转换成数字或字符串匹配值的稳定键。
 * @returns 把配置键转换成数字或字符串匹配值。
 */
function parseConfigKey(key: string): FuzzySearchMatchValue {
  if (isInteger(key)) {
    return parseInt(key, 10);
  }
  return key;
}

/**
 * 根据参数 `value`，判断配置值是否命中关键词。
 * @param value - 参与根据参数 `value`，判断配置值是否命中关键词比较、格式化或输出的候选值。
 * @param keyword - 决定根据参数 `value`，判断配置值是否命中关键词内容、边界或目标的 `keyword` 值。
 * @returns 满足根据参数 `value`，判断配置值是否命中关键词约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function configValueMatches(
  value: FuzzySearchConfigValue,
  keyword: string,
): boolean {
  if (typeof value === 'string') {
    return value === keyword;
  }
  if (Array.isArray(value)) {
    return value.includes(keyword);
  }
  if (value && typeof value === 'object') {
    return hasOwn(value, keyword);
  }
  return false;
}

/**
 * 根据参数 `config`，收集配置别名命中结果。
 * @param config - 限定根据参数 `config`，收集配置别名命中结果边界、地址与开关的运行配置，包含 `type` 字段。
 * @param keyword - 决定根据参数 `config`，收集配置别名命中结果内容、边界或目标的 `keyword` 值。
 * @returns 根据参数 `config`，收集配置别名命中。
 */
function collectConfigMatches(config: FuzzySearchConfig, keyword: string) {
  const result: Array<{ type: string; value: FuzzySearchMatchValue }> = [];

  for (const type in config) {
    const typeConfig = config[type];
    for (const key in typeConfig) {
      for (const value of typeConfig[key]) {
        if (configValueMatches(value, keyword)) {
          result.push({ type, value: parseConfigKey(key) });
        }
      }
    }
  }

  return result;
}
