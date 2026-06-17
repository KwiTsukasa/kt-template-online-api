import * as fs from 'fs';

import {
  checkRelationList,
  fuzzySearch,
  match,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import {
  createDefaultFuzzySearchRules,
  createFuzzySearchKeyword,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search-rules';
import type { FuzzySearchResult } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';
import { createBangDreamEntityMatcher } from '@/modules/qqbot/plugins/bangdream/src/domain/search/entity-list-matcher';
import { configureBangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

beforeAll(() => {
  configureBangDreamRuntimeIo({
    /**
     * 执行 BangDream回调。
     * @param filePath - BangDream路径；转换 JSON 文本。
     */
    readJsonFileSync: (filePath) =>
      JSON.parse(fs.readFileSync(filePath, 'utf8')),
  });
});

describe('BangDream fuzzy search helpers', () => {
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
      match({ _all: ['fire', 'bird'] }, { title: ['FIRE BIRD'] }, []),
    ).toBe(true);
    expect(
      match({ _all: ['fire', 'bird'] }, { title: ['Light a fire'] }, []),
    ).toBe(false);
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

  it('routes configured aliases through the rule set', () => {
    const rules = createDefaultFuzzySearchRules({
      songs: {
        '136': ['夏祭り'],
      },
    });
    const result: FuzzySearchResult = {};
    /**
     * 执行 BangDream 插件局部步骤。
     * @param key - 键名；影响 push 的返回值。
     */
    const push = (key: string) => (value: string | number) => {
      (result[key] ??= []).push(value);
    };

    expect(rules.match(createFuzzySearchKeyword('夏祭り'), push)).toBe(true);
    expect(result).toEqual({ songs: [136] });
  });
});

describe('BangDream entity list matcher', () => {
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

  /**
   * 创建 BangDream 插件。
   * @param id - BangDream记录 ID；定位本次读取、更新、删除或关联的BangDream记录。
   * @returns BangDream 插件产出的 TestEntity。
   */
  const createEntity = (id: number): TestEntity => ({
    id,
    name: `entity-${id}`,
    releasedAt: id === 2 ? [null, null, null, null, null] : [1, 1, 1, 1, 1],
  });

  const matchEntity = createBangDreamEntityMatcher<TestEntity>({
    source,
    createEntity,
    /**
     * 判断 BangDream 插件条件。
     * @param entity - entity 输入；使用 `releasedAt` 字段计算判断结果。
     * @param displayedServerList - displayedServerList 输入；计算 BangDream布尔判断。
     */
    isReleased: (entity, displayedServerList) =>
      displayedServerList.some((server) => entity.releasedAt[server] != null),
    /**
     * 判断 BangDream 插件条件。
     * @param matches - BangDream列表；驱动 `match()` 的 BangDream步骤。
     * @param entity - entity 输入；驱动 `match()` 的 BangDream步骤。
     */
    isMatched: (matches, entity) => match(matches, entity, []),
    /**
     * 执行 BangDream 插件局部步骤。
     * @param entity - entity 输入；使用 `id` 字段生成结果。
     */
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
    const matchDynamicEntity = createBangDreamEntityMatcher<TestEntity>({
      /**
       * 执行 BangDream回调。
       */
      source: () => dynamicSource,
      createEntity,
      /**
       * 判断 BangDream 插件条件。
       * @param entity - entity 输入；使用 `releasedAt` 字段计算判断结果。
       * @param displayedServerList - displayedServerList 输入；计算 BangDream布尔判断。
       */
      isReleased: (entity, displayedServerList) =>
        displayedServerList.some((server) => entity.releasedAt[server] != null),
      /**
       * 判断 BangDream 插件条件。
       * @param matches - BangDream列表；驱动 `match()` 的 BangDream步骤。
       * @param entity - entity 输入；驱动 `match()` 的 BangDream步骤。
       */
      isMatched: (matches, entity) => match(matches, entity, []),
      /**
       * 执行 BangDream 插件局部步骤。
       * @param entity - entity 输入；使用 `id` 字段生成结果。
       */
      relationValue: (entity) => entity.id,
    });

    expect(
      matchDynamicEntity({ _relationStr: ['1-3'] }, [CN_SERVER]),
    ).toHaveLength(1);

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
