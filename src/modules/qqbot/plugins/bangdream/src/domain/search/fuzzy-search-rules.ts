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
  /**
   * 初始化 FuzzySearchRules 实例。
   * @param rules - BangDream列表；影响 constructor 的返回值。
   */
  constructor(private readonly rules: readonly FuzzySearchRule[]) {}

  /**
   * 按注册顺序匹配并执行第一条可处理规则。
   *
   * @param keyword - keyword 输入；驱动 `rules.find()`、`rule.match()` 的 BangDream步骤。
   * @param push - push 输入；驱动 `rule.match()` 的 BangDream步骤。
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
 *
 * @param rawKeyword - rawKeyword 输入；执行 `rawKeyword.toLowerCase()` 对应的 BangDream步骤。
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
 * 创建默认模糊搜索规则注册表。
 *
 * @param config - config 输入；驱动 `FuzzySearchRules()` 的 BangDream步骤。
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
 * 创建数字 ID 规则。
 */
function createNumberRule(): FuzzySearchRule {
  return {
    /**
     * 判断 BangDream回调条件。
     * @param lowerKeyword - lowerKeyword 输入；驱动 `isInteger()` 的 BangDream步骤。
     */
    canHandle: ({ lowerKeyword }) => isInteger(lowerKeyword),
    /**
     * 执行 BangDream回调。
     * @param lowerKeyword - lowerKeyword 输入；驱动 `push()` 的 BangDream步骤。
     * @param push - push 输入；影响 match 的返回值。
     */
    match: ({ lowerKeyword }, push) =>
      push('_number')(parseInt(lowerKeyword, 10)),
    name: 'number',
  };
}

/**
 * 创建等级关键词规则。
 */
function createLevelRule(): FuzzySearchRule {
  return {
    /**
     * 判断 BangDream回调条件。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `extractLvNumber()` 的 BangDream步骤。
     */
    canHandle: ({ normalizedKeyword }) =>
      extractLvNumber(normalizedKeyword) !== null,
    /**
     * 执行 BangDream回调。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `push()` 的 BangDream步骤。
     * @param push - push 输入；影响 match 的返回值。
     */
    match: ({ normalizedKeyword }, push) =>
      push('songLevels')(extractLvNumber(normalizedKeyword) ?? 0),
    name: 'level',
  };
}

/**
 * 创建关系表达式规则。
 */
function createRelationRule(): FuzzySearchRule {
  return {
    /**
     * 判断 BangDream回调条件。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `isValidRelationStr()` 的 BangDream步骤。
     */
    canHandle: ({ normalizedKeyword }) => isValidRelationStr(normalizedKeyword),
    /**
     * 执行 BangDream回调。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `push()` 的 BangDream步骤。
     * @param push - push 输入；影响 match 的返回值。
     */
    match: ({ normalizedKeyword }, push) =>
      push('_relationStr')(normalizedKeyword),
    name: 'relation',
  };
}

/**
 * 创建配置别名规则。
 *
 * @param config - config 输入；驱动 `collectConfigMatches()`、`for()` 的 BangDream步骤。
 */
function createConfigRule(config: FuzzySearchConfig): FuzzySearchRule {
  return {
    /**
     * 判断 BangDream回调条件。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `collectConfigMatches()` 的 BangDream步骤。
     */
    canHandle: ({ normalizedKeyword }) =>
      collectConfigMatches(config, normalizedKeyword).length > 0,
    /**
     * 执行 BangDream回调。
     * @param normalizedKeyword - normalizedKeyword 输入；驱动 `for()` 的 BangDream步骤。
     * @param push - push 输入；影响 match 的返回值。
     */
    match: ({ normalizedKeyword }, push) => {
      for (const item of collectConfigMatches(config, normalizedKeyword)) {
        push(item.type)(item.value);
      }
    },
    name: 'config',
  };
}

/**
 * 创建兜底全文规则。
 */
function createFallbackRule(): FuzzySearchRule {
  return {
    /**
     * 判断 BangDream回调条件。
     */
    canHandle: () => true,
    /**
     * 执行 BangDream回调。
     * @param rawKeyword - rawKeyword 输入；驱动 `push()` 的 BangDream步骤。
     * @param push - push 输入；影响 match 的返回值。
     */
    match: ({ rawKeyword }, push) => push('_all')(rawKeyword),
    name: 'fallback',
  };
}

/**
 * 从等级关键词中提取数字等级。
 *
 * @param str - str 输入；提取正则匹配结果。
 */
function extractLvNumber(str: string): number | null {
  const match = str.match(/^lv(\d+)$/i);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * 判断字符串是否为非负整数。
 *
 * @param value - 待转换值；驱动 `INTEGER_PATTERN.test()` 的 BangDream步骤。
 */
function isInteger(value: string): boolean {
  return INTEGER_PATTERN.test(value);
}

/**
 * 判断 BangDream 插件条件。
 * @param source - source 输入；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 * @param key - 键名；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 把配置键转换成数字或字符串匹配值。
 *
 * @param key - 键名；驱动 `isInteger()` 的 BangDream步骤。
 */
function parseConfigKey(key: string): FuzzySearchMatchValue {
  return isInteger(key) ? parseInt(key, 10) : key;
}

/**
 * 判断配置值是否命中关键词。
 *
 * @param value - 待转换值；计算 BangDream布尔判断。
 * @param keyword - keyword 输入；驱动 `value.includes()`、`hasOwn()` 的 BangDream步骤。
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
 * 收集配置别名命中结果。
 *
 * @param config - config 输入；驱动 `for()` 的 BangDream步骤。
 * @param keyword - keyword 输入；决定 BangDream条件分支。
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
