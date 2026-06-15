import {
  createDefaultFuzzySearchRuleRegistry,
  createFuzzySearchKeyword,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search-rule.registry';
import { searchDictionaryRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/search/search-dictionary.repository';
import type {
  FuzzySearchConfig,
  FuzzySearchMatchValue,
  FuzzySearchResult,
  FuzzySearchResultWriter,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';

export type {
  FuzzySearchConfig,
  FuzzySearchConfigValue,
  FuzzySearchMatchValue,
  FuzzySearchResult,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';
export { checkRelationList } from '@/modules/qqbot/plugins/bangdream/src/domain/search/relation-matcher';

const KEYWORD_PATTERN = /["“”『』「」]([^"“”『』「」]+)["“”『』「」]|\S+/g;
const QUOTE_EDGE_PATTERN = /^["“”『』「」]|["“”『』「」]$/g;
const RESERVED_MATCH_KEYS = new Set(['_number', '_relationStr', '_all']);

export const config: FuzzySearchConfig =
  searchDictionaryRepository.loadConfig();
const ruleRegistry = createDefaultFuzzySearchRuleRegistry(config);

/**
 * 判断对象是否包含指定自有属性。
 *
 * @param source - 输入来源对象或数据集合。
 * @param key - 当前字段键名。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 按空白和引号拆分搜索关键词。
 *
 * @param keyword - 用户输入的搜索关键词。
 */
function extractKeywords(keyword: string): string[] {
  return (keyword.match(KEYWORD_PATTERN) || []).map((item) =>
    item.replace(QUOTE_EDGE_PATTERN, ''),
  );
}

/**
 * 创建向匹配结果追加值的写入器。
 *
 * @param matches - 模糊搜索命中结果。
 */
const appendTo =
  (matches: FuzzySearchResult): FuzzySearchResultWriter =>
  (key: string) =>
  (value: FuzzySearchMatchValue): void => {
    (matches[key] ??= []).push(value);
  };

/**
 * 校验模糊搜索结果结构。
 *
 * @param value - 当前处理的值。
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
 * 把用户关键词解析成结构化匹配条件。
 *
 * @param keyword - 用户输入的搜索关键词。
 */
export function fuzzySearch(keyword: string): FuzzySearchResult {
  const matches: FuzzySearchResult = {};
  const push = appendTo(matches);

  for (const rawKeyword of extractKeywords(keyword)) {
    ruleRegistry.match(createFuzzySearchKeyword(rawKeyword), push);
  }

  return matches;
}

/**
 * 判断字段是否为模糊搜索保留键。
 *
 * @param key - 当前字段键名。
 */
function isReservedMatchKey(key: string): boolean {
  return RESERVED_MATCH_KEYS.has(key);
}

/**
 * 判断候选值是否命中目标字段值。
 *
 * @param candidates - 候选匹配值列表。
 * @param targetValue - 待比较的目标值。
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
 * 判断数字别名是否命中目标字段。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param key - 当前字段键名。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
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
 * 判断目标对象指定字段是否命中搜索条件。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param key - 当前字段键名。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
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
 * 判断兜底关键词是否命中任意目标值。
 *
 * @param targetValue - 待比较的目标值。
 * @param searchValue - 标准化后的搜索值。
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
 * 判断目标对象是否包含兜底关键词。
 *
 * @param target - 待匹配或待写入的目标对象。
 * @param rawSearchValue - 原始搜索值。
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
 * 获取匹配条件 key 数量。
 *
 * @param matches - 模糊搜索命中结果。
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
 * 判断匹配结果是否只包含兜底关键词。
 *
 * @param matches - 模糊搜索命中结果。
 * @param keyCount - 匹配条件 key 数量。
 */
function matchesOnlyAll(matches: FuzzySearchResult, keyCount: number): boolean {
  return matches._all !== undefined && keyCount === 1;
}

/**
 * 执行结构化模糊搜索条件匹配。
 *
 * @param matches - 模糊搜索命中结果。
 * @param target - 待匹配或待写入的目标对象。
 * @param numberTypeKey - 允许使用数字别名匹配的字段列表。
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
