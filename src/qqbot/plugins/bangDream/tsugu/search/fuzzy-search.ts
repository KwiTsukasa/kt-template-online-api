import * as fs from 'fs';
import { fuzzySearchPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';

type FuzzySearchMatchValue = string | number;
type FuzzySearchConfigValue =
  | FuzzySearchMatchValue
  | FuzzySearchMatchValue[]
  | Record<string, unknown>;

interface FuzzySearchConfig {
  [type: string]: { [key: string]: FuzzySearchConfigValue[] };
}

export interface FuzzySearchResult {
  [key: string]: FuzzySearchMatchValue[];
}

const KEYWORD_PATTERN = /["“”『』「」]([^"“”『』「」]+)["“”『』「」]|\S+/g;
const QUOTE_EDGE_PATTERN = /^["“”『』「」]|["“”『』「」]$/g;
const RESERVED_MATCH_KEYS = new Set(['_number', '_relationStr', '_all']);
const RELATION_PATTERNS = [/^<\d+$/, /^>\d+$/, /^\d+-\d+$/];

/**
 * 在模糊搜索入口中判断对象是否包含指定自有属性。
 *
 * @param source - 输入来源对象或数据集合。
 * @param key - 当前字段键名。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 在模糊搜索入口中加载模糊搜索配置文件。
 *
 * @returns 处理结果。
 */
function loadConfig(): FuzzySearchConfig {
  const fileContent = fs.readFileSync(fuzzySearchPath, 'utf-8');
  logger('fuzzySearch', 'loaded fuzzy search config');
  return JSON.parse(fileContent);
}

/**
 * 在模糊搜索入口中从等级关键词中提取数字等级。
 *
 * @param str - str参数。
 * @returns 计算后的数值。
 */
function extractLvNumber(str: string): number | null {
  const match = str.match(/^lv(\d+)$/i);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * 在模糊搜索入口中判断字符串是否为非负整数。
 *
 * @param value - 当前处理的值。
 * @returns 判断结果。
 */
function isInteger(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

/**
 * 在模糊搜索入口中按空白和引号拆分搜索关键词。
 *
 * @param keyword - 用户输入的搜索关键词。
 * @returns 格式化后的文本。
 */
function extractKeywords(keyword: string): string[] {
  return (keyword.match(KEYWORD_PATTERN) || []).map((item) =>
    item.replace(QUOTE_EDGE_PATTERN, ''),
  );
}

/**
 * 在模糊搜索入口中统一关系表达式中的符号写法。
 *
 * @param keyword - 用户输入的搜索关键词。
 * @returns 格式化后的文本。
 */
function normalizeRelationKeyword(keyword: string): string {
  return keyword
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/＞/g, '>')
    .replace(/＜/g, '<');
}

/**
 * 在模糊搜索入口中创建向匹配结果追加值的写入器。
 *
 * @param matches - 模糊搜索命中结果。
 */
const appendTo =
  (matches: FuzzySearchResult) =>
  (key: string) =>
  (value: FuzzySearchMatchValue): void => {
    (matches[key] ??= []).push(value);
  };

/**
 * 在模糊搜索入口中把配置键转换成数字或字符串匹配值。
 *
 * @param key - 当前字段键名。
 * @returns 处理结果。
 */
function parseConfigKey(key: string): FuzzySearchMatchValue {
  return isInteger(key) ? parseInt(key, 10) : key;
}

/**
 * 在模糊搜索入口中判断配置值是否命中关键词。
 *
 * @param value - 当前处理的值。
 * @param keyword - 用户输入的搜索关键词。
 * @returns 判断结果。
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
 * 在模糊搜索入口中把配置命中结果写入模糊搜索结果。
 *
 * @param keyword - 用户输入的搜索关键词。
 * @param push - push参数。
 * @returns 判断结果。
 */
function appendConfigMatches(
  keyword: string,
  push: ReturnType<typeof appendTo>,
): boolean {
  let matched = false;

  for (const type in config) {
    const typeConfig = config[type];
    const pushType = push(type);

    for (const key in typeConfig) {
      const matchValue = parseConfigKey(key);
      for (const value of typeConfig[key]) {
        if (!configValueMatches(value, keyword)) {
          continue;
        }

        pushType(matchValue);
        matched = true;
      }
    }
  }

  return matched;
}

export const config: FuzzySearchConfig = loadConfig();

// 自定义验证函数
/**
 * 在模糊搜索入口中校验模糊搜索结果结构。
 *
 * @param value - 当前处理的值。
 * @returns 判断结果。
 */
export function isFuzzySearchResult(
  value: unknown,
): value is FuzzySearchResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value).every(
    (arr) =>
      Array.isArray(arr) &&
      arr.every((item) => typeof item === 'string' || typeof item === 'number'),
  );
}

/**
 * 在模糊搜索入口中把用户关键词解析成结构化匹配条件。
 *
 * @param keyword - 用户输入的搜索关键词。
 * @returns 处理结果。
 */
export function fuzzySearch(keyword: string): FuzzySearchResult {
  const matches: FuzzySearchResult = {};
  const push = appendTo(matches);

  for (const rawKeyword of extractKeywords(keyword)) {
    const keywordLowerCase = rawKeyword.toLowerCase();

    if (isInteger(keywordLowerCase)) {
      push('_number')(parseInt(keywordLowerCase, 10));
      continue;
    }

    const normalizedKeyword = normalizeRelationKeyword(keywordLowerCase);
    const lvNumber = extractLvNumber(normalizedKeyword);
    if (lvNumber !== null) {
      push('songLevels')(lvNumber);
      continue;
    }

    if (isValidRelationStr(normalizedKeyword)) {
      push('_relationStr')(normalizedKeyword);
      continue;
    }

    if (appendConfigMatches(normalizedKeyword, push)) {
      continue;
    }

    push('_all')(rawKeyword);
  }

  return matches;
}

/**
 * 在模糊搜索入口中判断关系表达式是否可用于范围匹配。
 *
 * @param _relationStr - 关系表达式Str参数。
 * @returns 判断结果。
 */
function isValidRelationStr(_relationStr: string): boolean {
  return RELATION_PATTERNS.some((pattern) => pattern.test(_relationStr));
}

/**
 * 在模糊搜索入口中判断字段是否为模糊搜索保留键。
 *
 * @param key - 当前字段键名。
 * @returns 判断结果。
 */
function isReservedMatchKey(key: string): boolean {
  return RESERVED_MATCH_KEYS.has(key);
}

/**
 * 在模糊搜索入口中判断候选值是否命中目标字段值。
 *
 * @param candidates - 候选匹配值列表。
 * @param targetValue - 待比较的目标值。
 * @returns 判断结果。
 */
function candidateMatches(
  candidates: FuzzySearchMatchValue[],
  targetValue: unknown,
): boolean {
  if (Array.isArray(targetValue)) {
    return targetValue.some((item) => candidateMatches(candidates, item));
  }
  if (typeof targetValue === 'string') {
    return candidates.some(
      (candidate) =>
        typeof candidate === 'string' &&
        candidate.toLowerCase() === targetValue.toLowerCase(),
    );
  }
  if (typeof targetValue === 'number') {
    return candidates.some(
      (candidate) => typeof candidate === 'number' && candidate === targetValue,
    );
  }
  return false;
}

/**
 * 在模糊搜索入口中判断数字别名是否命中目标字段。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param key - 当前字段键名。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
 * @returns 判断结果。
 */
function numberAliasMatches(
  matches: FuzzySearchResult,
  target: any,
  key: string,
  numberTypeKey: string[],
): boolean {
  return (
    numberTypeKey.includes(key) &&
    Array.isArray(matches._number) &&
    matches._number.includes(target[key] as FuzzySearchMatchValue)
  );
}

/**
 * 在模糊搜索入口中判断目标对象指定字段是否命中搜索条件。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param key - 当前字段键名。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
 * @returns 判断结果。
 */
function targetMatchesKey(
  matches: FuzzySearchResult,
  target: any,
  key: string,
  numberTypeKey: string[],
): boolean {
  if (target[key] !== undefined) {
    return candidateMatches(matches[key], target[key]);
  }
  return numberAliasMatches(matches, target, key, numberTypeKey);
}

/**
 * 在模糊搜索入口中判断兜底关键词是否命中任意目标值。
 *
 * @param targetValue - 待比较的目标值。
 * @param searchValue - 标准化后的搜索值。
 * @returns 判断结果。
 */
function allKeywordMatches(targetValue: unknown, searchValue: string): boolean {
  if (typeof targetValue === 'string') {
    return targetValue.toLowerCase().includes(searchValue);
  }
  if (Array.isArray(targetValue)) {
    return targetValue.some(
      (item) =>
        typeof item === 'string' && item.toLowerCase().includes(searchValue),
    );
  }
  return false;
}

/**
 * 在模糊搜索入口中处理targetIncludes全部关键词。
 *
 * @param target - 待匹配或待写入的目标对象。
 * @param rawSearchValue - raw搜索值参数。
 * @returns 判断结果。
 */
function targetIncludesAllKeyword(
  target: any,
  rawSearchValue: FuzzySearchMatchValue,
): boolean {
  if (typeof rawSearchValue !== 'string') {
    return false;
  }

  const searchValue = rawSearchValue.toLowerCase();
  for (const key in target) {
    if (allKeywordMatches(target[key], searchValue)) {
      return true;
    }
  }
  return false;
}

/**
 * 在模糊搜索入口中获取匹配KeyCount。
 *
 * @param matches - 模糊搜索命中结果。
 * @returns 计算后的数值。
 */
function getMatchKeyCount(matches: FuzzySearchResult): number {
  let count = 0;
  for (const key in matches) {
    if (hasOwn(matches, key)) {
      count++;
    }
  }
  return count;
}

/**
 * 在模糊搜索入口中处理匹配结果Only全部。
 *
 * @param matches - 模糊搜索命中结果。
 * @param keyCount - keyCount参数。
 * @returns 判断结果。
 */
function matchesOnlyAll(matches: FuzzySearchResult, keyCount: number): boolean {
  return matches._all !== undefined && keyCount === 1;
}

/**
 * 在模糊搜索入口中执行结构化模糊搜索条件匹配。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
 * @returns 判断结果。
 */
export function match(
  matches: FuzzySearchResult,
  target: any,
  numberTypeKey: string[],
): boolean {
  if (!target) {
    return false;
  }

  const keyCount = getMatchKeyCount(matches);
  if (keyCount === 0) {
    return true;
  }

  if (matchesOnlyAll(matches, keyCount)) {
    return matches._all.some((keyword) =>
      targetIncludesAllKeyword(target, keyword),
    );
  }

  let matched = false;
  for (const key in matches) {
    if (!hasOwn(matches, key)) {
      continue;
    }
    if (isReservedMatchKey(key)) {
      continue;
    }
    if (!targetMatchesKey(matches, target, key, numberTypeKey)) {
      return false;
    }
    matched = true;
  }

  return matched;
}

interface RelationChecker {
  pattern: RegExp;
  test: (num: number, match: RegExpMatchArray) => boolean;
}

const RELATION_CHECKERS: RelationChecker[] = [
  {
    pattern: /^<(\d+)$/,
    /**
     * 在模糊搜索入口中处理test。
     *
     * @param num - num参数。
     * @param match - 匹配参数。
     */
    test: (num, match) => num < parseFloat(match[1]),
  },
  {
    pattern: /^>(\d+)$/,
    /**
     * 在模糊搜索入口中处理test。
     *
     * @param num - num参数。
     * @param match - 匹配参数。
     */
    test: (num, match) => num > parseFloat(match[1]),
  },
  {
    pattern: /^(\d+)-(\d+)$/,
    /**
     * 在模糊搜索入口中处理test。
     *
     * @param num - num参数。
     * @param match - 匹配参数。
     */
    test: (num, match) =>
      num >= parseFloat(match[1]) && num <= parseFloat(match[2]),
  },
];

/**
 * 在模糊搜索入口中创建数值关系表达式匹配器。
 *
 * @param _relationStr - 关系表达式Str参数。
 * @returns 判断结果。
 */
function createRelationMatcher(_relationStr: string): (num: number) => boolean {
  for (const checker of RELATION_CHECKERS) {
    const relationMatch = _relationStr.match(checker.pattern);
    if (relationMatch) {
      return (num) => checker.test(num, relationMatch);
    }
  }
  throw new Error('Invalid relation string format');
}

// 以下为数字与范围函数
/**
 * 在模糊搜索入口中检查数值列表是否满足关系表达式。
 *
 * @param num - num参数。
 * @param _relationStrList - 关系表达式Str列表参数。
 * @returns 判断结果。
 */
export function checkRelationList(
  num: number,
  _relationStrList: string[],
): boolean {
  for (const relationStr of _relationStrList) {
    try {
      if (createRelationMatcher(relationStr)(num)) {
        return true;
      }
    } catch {
      logger('fuzzySearch', 'Invalid relation string format');
    }
  }
  return false;
}
