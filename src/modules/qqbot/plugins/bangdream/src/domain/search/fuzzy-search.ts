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
   * 从延迟加载的模糊搜索配置读取指定键值，并保持 Proxy 对最新缓存可见。
   * @param _target - 为兼容既有调用签名保留；当前实现不会读取该参数。
   * @param key - 用于读取或更新`get` 对应结果的稳定键。
   * @returns `get` 对应。
   */
  get(_target, key: string) {
    return getFuzzySearchConfig()[key];
  },
}) as FuzzySearchConfig;

/**
 * 按当前运行态读取模糊搜索Search配置。
 * @returns 模糊搜索Search配置。
 */
function getFuzzySearchConfig() {
  cachedConfig ??= searchDictionaryRepository.loadConfig();
  return cachedConfig;
}

/**
 * 按当前运行态读取模糊搜索SearchRules；从 `getFuzzySearchConfig` 读取模糊搜索SearchRules。
 * @returns 模糊搜索SearchRules。
 */
function getFuzzySearchRules() {
  cachedRules ??= createDefaultFuzzySearchRules(getFuzzySearchConfig());
  return cachedRules;
}

const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 按空白和引号拆分搜索关键词。
 * @param keyword - 用于按空白和引号拆分搜索关键词的领域对象，包含 `match` 字段。
 * @returns 按输入顺序得到的按空白和引号拆分搜索关键词列表；没有匹配项时为空数组。
 */
function extractKeywords(keyword: string): string[] {
  return (keyword.match(KEYWORD_PATTERN) || []).map((item) =>
    item.replace(QUOTE_EDGE_PATTERN, ''),
  );
}

const appendTo =
  (matches: FuzzySearchResult): FuzzySearchResultWriter =>
  (key: string) =>
  (value: FuzzySearchMatchValue): void => {
    (matches[key] ??= []).push(value);
  };

/**
 * 根据`value`与当前约束判定模糊搜索结果结构；当 `typeof value !== 'object' || value === null` 成立时返回 `false`。
 * @param value - 待判定是否满足模糊搜索结果结构约束的候选值。
 * @returns 满足模糊搜索结果结构约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * @param keyword - 决定把用户关键词解析成结构化匹配条件内容、边界或目标的 `keyword` 值。
 * @returns 把用户关键词解析成结构化匹配条件。
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
 * 根据参数 `key`，判断字段是否为模糊搜索保留键。
 * @param key - 用于读取或更新根据参数 `key`，判断字段是否为模糊搜索保留键的稳定键。
 * @returns 满足根据参数 `key`，判断字段是否为模糊搜索保留键约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isReservedMatchKey(key: string): boolean {
  return RESERVED_MATCH_KEYS.has(key);
}

/**
 * 根据`candidates`、`targetValue`与当前约束判定候选值是否命中目标字段值；当 `Array.isArray(targetValue)` 成立时返回 `targetValue.some((item) => candidateMatches…`。
 * @param candidates - 决定是否启用“candidates”分支的布尔选项。
 * @param targetValue - 决定候选值是否命中目标字段值内容、边界或目标的 `targetValue` 值。
 * @returns 满足候选值是否命中目标字段值约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 根据`matches`、`target`、`key`处理数字别名是否命中目标字段。
 * @param matches - 用于数字别名是否命中目标字段的领域对象，包含 `_number` 字段。
 * @param target - 用于数字别名是否命中目标字段的领域对象，包含 `key` 字段。
 * @param key - 用于读取或更新数字别名是否命中目标字段的稳定键。
 * @param numberTypeKey - 用于读取或更新数字别名是否命中目标字段的稳定键。
 * @returns 数字别名是否命中目标字段。
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
 * 根据参数 `matches`，判断目标对象指定字段是否命中搜索条件。
 * @param matches - 用于根据参数 `matches`，判断目标对象指定字段是否命中搜索条件的领域对象，包含 `key` 字段。
 * @param target - 用于根据参数 `matches`，判断目标对象指定字段是否命中搜索条件的领域对象，包含 `key` 字段。
 * @param key - 用于读取或更新根据参数 `matches`，判断目标对象指定字段是否命中搜索条件的稳定键。
 * @param numberTypeKey - 用于读取或更新根据参数 `matches`，判断目标对象指定字段是否命中搜索条件的稳定键。
 * @returns 根据参数 `matches`，判断目标对象指定字段是否命中搜索条件。
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
 * 根据`targetValue`、`searchValue`处理兜底关键词是否命中任意目标值；当 `typeof targetValue === 'string'` 成立时返回 `targetValue.toLowerCase().includes(searchVa…`。
 * @param targetValue - 决定兜底关键词是否命中任意目标值内容、边界或目标的 `targetValue` 值。
 * @param searchValue - 决定兜底关键词是否命中任意目标值内容、边界或目标的 `searchValue` 值。
 * @returns 满足兜底关键词是否命中任意目标值约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 根据参数 `target`，判断目标对象是否包含兜底关键词。
 * @param target - 用于根据参数 `target`，判断目标对象是否包含兜底关键词的领域对象，包含 `key` 字段。
 * @param rawSearchValue - 决定根据参数 `target`，判断目标对象是否包含兜底关键词内容、边界或目标的 `rawSearchValue` 值。
 * @returns 满足根据参数 `target`，判断目标对象是否包含兜底关键词约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 根据参数 `matches`，获取匹配条件 key 数量。
 * @param matches - 决定根据参数 `matches`，获取匹配条件 key 数量内容、边界或目标的 `matches` 值。
 * @returns 根据参数 `matches`，获取匹配条件 key 数量。
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
 * 根据`matches`、`keyCount`与当前约束判定匹配结果是否只包含兜底关键词。
 * @param matches - 用于匹配结果是否只包含兜底关键词的领域对象，包含 `_all` 字段。
 * @param keyCount - 限制匹配结果是否只包含兜底关键词数量、尺寸、等级或重试边界的数值。
 * @returns 满足匹配结果是否只包含兜底关键词约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
 */
function matchesOnlyAll(matches: FuzzySearchResult, keyCount: number): boolean {
  return matches._all !== undefined && keyCount === 1;
}

/**
 * 根据参数 `matches`，执行结构化模糊搜索条件匹配。
 * @param matches - 用于根据参数 `matches`，执行结构化模糊搜索条件匹配的领域对象，包含 `_all` 字段。
 * @param target - 决定根据参数 `matches`，执行结构化模糊搜索条件匹配内容、边界或目标的 `target` 值。
 * @param numberTypeKey - 用于读取或更新根据参数 `matches`，执行结构化模糊搜索条件匹配的稳定键。
 * @returns 满足根据参数 `matches`，执行结构化模糊搜索条件匹配约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
