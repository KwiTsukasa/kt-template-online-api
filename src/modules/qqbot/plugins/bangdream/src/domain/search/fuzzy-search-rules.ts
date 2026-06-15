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
   *
   * @param keyword - 结构化关键词。
   * @param push - 搜索结果写入器。
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
 * @param rawKeyword - 用户输入关键词。
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
 * @param config - 搜索别名配置。
 */
export function createDefaultFuzzySearchRules(
  config: FuzzySearchConfig,
) {
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
    canHandle: ({ lowerKeyword }) => isInteger(lowerKeyword),
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
    canHandle: ({ normalizedKeyword }) =>
      extractLvNumber(normalizedKeyword) !== null,
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
    canHandle: ({ normalizedKeyword }) => isValidRelationStr(normalizedKeyword),
    match: ({ normalizedKeyword }, push) =>
      push('_relationStr')(normalizedKeyword),
    name: 'relation',
  };
}

/**
 * 创建配置别名规则。
 *
 * @param config - 搜索别名配置。
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
 * 创建兜底全文规则。
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
 *
 * @param str - 标准化后的关键词。
 */
function extractLvNumber(str: string): number | null {
  const match = str.match(/^lv(\d+)$/i);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * 判断字符串是否为非负整数。
 *
 * @param value - 当前处理的值。
 */
function isInteger(value: string): boolean {
  return INTEGER_PATTERN.test(value);
}

/**
 * 判断对象是否包含指定自有属性。
 *
 * @param source - 输入来源对象或数据集合。
 * @param key - 当前字段键名。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 把配置键转换成数字或字符串匹配值。
 *
 * @param key - 当前字段键名。
 */
function parseConfigKey(key: string): FuzzySearchMatchValue {
  return isInteger(key) ? parseInt(key, 10) : key;
}

/**
 * 判断配置值是否命中关键词。
 *
 * @param value - 当前处理的值。
 * @param keyword - 用户输入的搜索关键词。
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
 * @param config - 搜索别名配置。
 * @param keyword - 标准化后的关键词。
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
