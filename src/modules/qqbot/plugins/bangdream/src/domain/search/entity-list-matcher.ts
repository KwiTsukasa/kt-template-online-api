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

const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

const getMatchKeyCount = (matches: FuzzySearchResult): number => {
  let count = 0;
  for (const key in matches) {
    if (hasOwn(matches, key)) {
      count++;
    }
  }
  return count;
};

const getRelationList = (matches: FuzzySearchResult): string[] | undefined =>
  {
    if (Array.isArray(matches._relationStr)) {
      return (matches._relationStr as string[]);
    }
    return undefined;
  };

const getCurrentSource = (
  source: BangDreamEntityMatcherOptions<unknown>['source'],
) => {
  if (typeof source === 'function') {
    return source();
  }
  return source;
};

const shouldCheckRelation =
  (relationList: string[] | undefined, relationOnly: boolean) =>
  (baseMatched: boolean) =>
    relationList !== undefined && (baseMatched || relationOnly);

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
      const matched = (() => {
        if (useRelation(baseMatched)) {
          return checkRelationList(relationValue(entity), relationList ?? []);
        }
        return baseMatched;
      })();

      if (matched) {
        result.push(entity);
      }
    }

    return result;
  };
