import {
  checkRelationList,
  fuzzySearch,
  match,
} from '@/qqbot/plugins/bangDream/search/fuzzy-search';
import {
  createDefaultFuzzySearchRuleRegistry,
  createFuzzySearchKeyword,
} from '@/qqbot/plugins/bangDream/search/fuzzy-search-rule.registry';
import type { FuzzySearchResult } from '@/qqbot/plugins/bangDream/search/fuzzy-search.types';
import { createTsuguEntityMatcher } from '@/qqbot/plugins/bangDream/search/entity-list-matcher';

describe('Tsugu fuzzy search helpers', () => {
  it('parses number, level, relation and quoted fallback keywords', () => {
    expect(fuzzySearch('136 lv25 ＞100 "夏祭り"')).toEqual({
      _number: [136],
      songLevels: [25],
      _relationStr: ['>100'],
      _all: ['夏祭り'],
    });
  });

  it('matches scalar, array and fallback text fields', () => {
    expect(match({ songLevels: [25] }, { songLevels: [24, 25] }, [])).toBe(
      true,
    );
    expect(match({ songLevels: [25] }, { songLevels: [24] }, [])).toBe(false);
    expect(match({ _all: ['summer'] }, { title: ['Summer Dive'] }, [])).toBe(
      true,
    );
    expect(
      match(
        { scoreUpMaxValue: [100], _number: [100] },
        { scoreUpMaxValue: 100 },
        ['scoreUpMaxValue'],
      ),
    ).toBe(true);
  });

  it('checks numeric relation expressions', () => {
    expect(checkRelationList(136, ['<100', '130-140'])).toBe(true);
    expect(checkRelationList(136, ['<100', '>200'])).toBe(false);
  });

  it('routes configured aliases through the rule registry', () => {
    const registry = createDefaultFuzzySearchRuleRegistry({
      songs: {
        '136': ['夏祭り'],
      },
    });
    const result: FuzzySearchResult = {};
    const push = (key: string) => (value: string | number) => {
      (result[key] ??= []).push(value);
    };

    expect(registry.match(createFuzzySearchKeyword('夏祭り'), push)).toBe(
      true,
    );
    expect(result).toEqual({ songs: [136] });
  });
});

describe('Tsugu entity list matcher', () => {
  const CN_SERVER = 3;

  interface TestEntity {
    id: number;
    name: string;
    releasedAt: Array<number | null>;
  }

  const source = {
    '1': {},
    '2': {},
    '3': {},
  };

  const createEntity = (id: number): TestEntity => ({
    id,
    name: `entity-${id}`,
    releasedAt: id === 2 ? [null, null, null, null, null] : [1, 1, 1, 1, 1],
  });

  const matchEntity = createTsuguEntityMatcher<TestEntity>({
    source,
    createEntity,
    isReleased: (entity, displayedServerList) =>
      displayedServerList.some((server) => entity.releasedAt[server] != null),
    isMatched: (matches, entity) => match(matches, entity, []),
    relationValue: (entity) => entity.id,
  });

  it('filters unreleased entities before relation matching', () => {
    const result = matchEntity({ _relationStr: ['1-3'] }, [CN_SERVER]);

    expect(result.map((entity) => entity.id)).toEqual([1, 3]);
  });

  it('keeps configured field matching behavior', () => {
    const result = matchEntity({ name: ['entity-3'] }, [CN_SERVER]);

    expect(result.map((entity) => entity.id)).toEqual([3]);
  });

  it('reads entity source lazily when matching', () => {
    let dynamicSource: Record<string, unknown> = {
      '1': {},
    };
    const matchDynamicEntity = createTsuguEntityMatcher<TestEntity>({
      source: () => dynamicSource,
      createEntity,
      isReleased: (entity, displayedServerList) =>
        displayedServerList.some((server) => entity.releasedAt[server] != null),
      isMatched: (matches, entity) => match(matches, entity, []),
      relationValue: (entity) => entity.id,
    });

    expect(matchDynamicEntity({ _relationStr: ['1-3'] }, [CN_SERVER])).toHaveLength(
      1,
    );

    dynamicSource = {
      '1': {},
      '3': {},
    };

    expect(
      matchDynamicEntity({ _relationStr: ['1-3'] }, [CN_SERVER]).map(
        (entity) => entity.id,
      ),
    ).toEqual([1, 3]);
  });
});
