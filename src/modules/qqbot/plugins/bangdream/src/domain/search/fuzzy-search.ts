import {
  createDefaultFuzzySearchRules,
  createFuzzySearchKeyword,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search-rules';
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

let cachedConfig: FuzzySearchConfig | undefined;
let cachedRules: ReturnType<typeof createDefaultFuzzySearchRules> | undefined;

export const config = new Proxy({} as FuzzySearchConfig, {
  /**
   * 获取业务数据。
   * @param _target - _target 输入；限定 BangDream查询范围。
   * @param key - 键名；驱动 `getFuzzySearchConfig()` 的 BangDream步骤。
   */
  get(_target, key: string) {
    return getFuzzySearchConfig()[key];
  },
}) as FuzzySearchConfig;

/**
 * 查询 BangDream 插件数据。
 */
function getFuzzySearchConfig() {
  cachedConfig ??= searchDictionaryRepository.loadConfig();
  return cachedConfig;
}

/**
 * 查询 BangDream 插件数据。
 */
function getFuzzySearchRules() {
  cachedRules ??= createDefaultFuzzySearchRules(getFuzzySearchConfig());
  return cachedRules;
}

/**
 * 判断 BangDream 插件条件。
 * @param source - source 输入；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 * @param key - 键名；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 按空白和引号拆分搜索关键词。
 *
 * @param keyword - keyword 输入；提取正则匹配结果。
 */
function extractKeywords(keyword: string): string[] {
  return (keyword.match(KEYWORD_PATTERN) || []).map((item) =>
    item.replace(QUOTE_EDGE_PATTERN, ''),
  );
}

/**
 * 执行 BangDream 插件流程。
 * @param matches - BangDream列表；影响 appendTo 的返回值。
 * @returns BangDream 插件产出的 FuzzySearchResultWriter。
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
 * @param value - 待转换值；驱动 `Object.values()` 的 BangDream步骤。
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
 * @param keyword - keyword 输入；驱动 `for()` 的 BangDream步骤。
 */
export function fuzzySearch(keyword: string): FuzzySearchResult {
  const matches: FuzzySearchResult = {};
  const push = appendTo(matches);

  for (const rawKeyword of extractKeywords(keyword)) {
    getFuzzySearchRules().match(createFuzzySearchKeyword(rawKeyword), push);
  }

  return matches;
}

/**
 * 判断字段是否为模糊搜索保留键。
 *
 * @param key - 键名；驱动 `RESERVED_MATCH_KEYS.has()` 的 BangDream步骤。
 */
function isReservedMatchKey(key: string): boolean {
  return RESERVED_MATCH_KEYS.has(key);
}

/**
 * 判断候选值是否命中目标字段值。
 *
 * @param candidates - BangDream列表；计算 BangDream布尔判断。
 * @param targetValue - targetValue 输入；计算 BangDream布尔判断。
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
 * @param matches - BangDream列表；使用 `_number` 字段生成结果。
 * @param target - target 输入；影响 numberAliasMatches 的返回值。
 * @param key - 键名；影响 numberAliasMatches 的返回值。
 * @param numberTypeKey - numberTypeKey 输入；计算 BangDream布尔判断。
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
 * @param matches - BangDream列表；驱动 `candidateMatches()`、`numberAliasMatches()` 的 BangDream步骤。
 * @param target - target 输入；驱动 `candidateMatches()`、`numberAliasMatches()` 的 BangDream步骤。
 * @param key - 键名；驱动 `candidateMatches()`、`numberAliasMatches()` 的 BangDream步骤。
 * @param numberTypeKey - numberTypeKey 输入；驱动 `numberAliasMatches()` 的 BangDream步骤。
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
 * @param targetValue - targetValue 输入；计算 BangDream布尔判断。
 * @param searchValue - searchValue 输入；驱动 `targetValue.toLowerCase()`、`targetValue.some()` 的 BangDream步骤。
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
 * @param target - target 输入；驱动 `for()` 的 BangDream步骤。
 * @param rawSearchValue - rawSearchValue 输入；执行 `rawSearchValue.toLowerCase()` 对应的 BangDream步骤。
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
 * @param matches - BangDream列表；驱动 `for()` 的 BangDream步骤。
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
 * @param matches - BangDream列表；使用 `_all` 字段生成结果。
 * @param keyCount - keyCount 输入；影响 matchesOnlyAll 的返回值。
 */
function matchesOnlyAll(matches: FuzzySearchResult, keyCount: number): boolean {
  return matches._all !== undefined && keyCount === 1;
}

/**
 * 执行结构化模糊搜索条件匹配。
 *
 * @param matches - BangDream列表；使用 `_all` 字段生成结果。
 * @param target - target 输入；驱动 `_all.every()` 的 BangDream步骤。
 * @param numberTypeKey - numberTypeKey 输入；决定 BangDream条件分支。
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
    return matches._all.every((keyword) =>
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
