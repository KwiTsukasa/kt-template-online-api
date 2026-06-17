import type { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { checkRelationList } from '@/modules/qqbot/plugins/bangdream/src/domain/search/relation-matcher';
import type { FuzzySearchResult } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';

interface BangDreamEntityMatcherOptions<T> {
  source: Record<string, unknown> | (() => Record<string, unknown>);
  createEntity: (id: number) => T;
  isCandidate?: (entity: T) => boolean;
  isReleased: (entity: T, displayedServerList: Server[]) => boolean;
  isMatched: (matches: FuzzySearchResult, entity: T) => boolean;
  relationValue: (entity: T) => number;
}

/**
 * 判断 BangDream 插件条件。
 * @param source - source 输入；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 * @param key - 键名；驱动 `hasOwnProperty.call()` 的 BangDream步骤。
 */
const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

/**
 * 查询 BangDream 插件数据。
 * @param matches - BangDream列表；驱动 `for()` 的 BangDream步骤。
 * @returns BangDream 插件查询结果。
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
 * 查询 BangDream 插件数据。
 * @param matches - BangDream列表；使用 `_relationStr` 字段生成结果。
 * @returns BangDream 插件查询结果。
 */
const getRelationList = (matches: FuzzySearchResult): string[] | undefined =>
  Array.isArray(matches._relationStr)
    ? (matches._relationStr as string[])
    : undefined;

/**
 * 查询 BangDream 插件数据。
 * @param source - source 输入；限定 BangDream查询范围。
 */
const getCurrentSource = (
  source: BangDreamEntityMatcherOptions<unknown>['source'],
) => (typeof source === 'function' ? source() : source);

/**
 * 判断是否需要执行关系表达式筛选。
 * @param relationList - relationList 输入；计算 BangDream判断结果。
 * @param relationOnly - relationOnly 输入；计算 BangDream判断结果。
 */
const shouldCheckRelation =
  (relationList: string[] | undefined, relationOnly: boolean) =>
  (baseMatched: boolean) =>
    relationList !== undefined && (baseMatched || relationOnly);

/**
 * 创建 BangDream 插件对象或配置。
 * @param { source, createEntity, isCandidate, isReleased, isMatched, relationValue, } - 领域实体匹配配置，提供原始索引、实体工厂、发布状态过滤和关系表达式取值逻辑。
 */
export const createBangDreamEntityMatcher =
  <T>({
    source,
    createEntity,
    isCandidate,
    isReleased,
    isMatched,
    relationValue,
  }: BangDreamEntityMatcherOptions<T>) =>
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
