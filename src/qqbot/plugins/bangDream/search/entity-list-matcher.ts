import type { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { checkRelationList } from '@/qqbot/plugins/bangDream/search/relation-matcher';
import type { FuzzySearchResult } from '@/qqbot/plugins/bangDream/search/fuzzy-search.types';

interface TsuguEntityMatcherOptions<T> {
  source: Record<string, unknown> | (() => Record<string, unknown>);
  createEntity: (id: number) => T;
  isCandidate?: (entity: T) => boolean;
  isReleased: (entity: T, displayedServerList: Server[]) => boolean;
  isMatched: (matches: FuzzySearchResult, entity: T) => boolean;
  relationValue: (entity: T) => number;
}

/**
 * 在QQBot 图片视图层中判断对象是否包含指定自有属性。
 *
 * @param source - 输入来源对象或数据集合。
 * @param key - 当前字段键名。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 在QQBot 图片视图层中获取匹配KeyCount。
 *
 * @param matches - 模糊搜索命中结果。
 * @returns 计算后的数值。
 */
const getMatchKeyCount = (matches: FuzzySearchResult): number => {
  let count = 0;
  for (const key in matches) {
    if (hasOwn(matches, key)) {
      count++;
    }
  }
  return count;
};

/**
 * 在QQBot 图片视图层中获取关系表达式列表。
 *
 * @param matches - 模糊搜索命中结果。
 * @returns 格式化后的文本。
 */
const getRelationList = (matches: FuzzySearchResult): string[] | undefined =>
  Array.isArray(matches._relationStr)
    ? (matches._relationStr as string[])
    : undefined;

/**
 * 在QQBot 图片视图层中获取当前实体源。
 *
 * @param source - 静态实体源或延迟读取函数。
 */
const getCurrentSource = (
  source: TsuguEntityMatcherOptions<unknown>['source'],
) => (typeof source === 'function' ? source() : source);

/**
 * 在QQBot 图片视图层中判断是否需要Check关系表达式。
 *
 * @param relationList - 关系表达式列表参数。
 * @param relationOnly - 关系表达式Only参数。
 */
const shouldCheckRelation =
  (relationList: string[] | undefined, relationOnly: boolean) =>
  (baseMatched: boolean) =>
    relationList !== undefined && (baseMatched || relationOnly);

/**
 * 在QQBot 图片视图层中创建TsuguEntity匹配器。
 *
 * @param options1 - options1参数。
 */
export const createTsuguEntityMatcher =
  <T>({
    source,
    createEntity,
    isCandidate,
    isReleased,
    isMatched,
    relationValue,
  }: TsuguEntityMatcherOptions<T>) =>
  (matches: FuzzySearchResult, displayedServerList: Server[]): T[] => {
    const result: T[] = [];
    const currentSource = getCurrentSource(source);
    const relationList = getRelationList(matches);
    const relationOnly =
      relationList !== undefined && getMatchKeyCount(matches) === 1;
    const useRelation = shouldCheckRelation(relationList, relationOnly);

    for (const id in currentSource) {
      if (!hasOwn(currentSource, id)) {
        continue;
      }

      const entity = createEntity(Number(id));
      if (isCandidate && !isCandidate(entity)) {
        continue;
      }
      if (!isReleased(entity, displayedServerList)) {
        continue;
      }

      const baseMatched = isMatched(matches, entity);
      const matched = useRelation(baseMatched)
        ? checkRelationList(relationValue(entity), relationList ?? [])
        : baseMatched;

      if (matched) {
        result.push(entity);
      }
    }

    return result;
  };
