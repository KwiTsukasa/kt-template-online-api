import {
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_SERVER_ID_BY_CODE,
  BangDreamServerCode,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  BANGDREAM_DEFAULT_DIFFICULTY_ALIASES,
  BANGDREAM_DEFAULT_SERVER_ALIASES,
  BANGDREAM_DICTIONARY_CODES,
} from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/default-dictionary';
import { BANGDREAM_DEFAULT_SERVER_IDS } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';

export type BangDreamDictionaryItem = {
  label: string;
  value: number | string;
};

export type BangDreamDictionaryFetcher = (
  dictCode: string,
) => Promise<BangDreamDictionaryItem[]>;

export type BangDreamResolvedServer = 0 | 1 | 2 | 3 | 4;

export class BangDreamDictionaryLoader {
  private difficultyAliasMap = this.buildDifficultyAliasMap([]);
  private serverAliasMap = this.buildServerAliasMap([]);

  /**
   * 执行 BangDream 插件流程。
   * @param fetcher - fetcher 输入；驱动 `Promise.all()` 的 BangDream步骤。
   */
  async refresh(fetcher?: BangDreamDictionaryFetcher) {
    if (!fetcher) {
      this.reset();
      return;
    }

    try {
      const [serverAliasItems, difficultyAliasItems] = await Promise.all([
        fetcher(BANGDREAM_DICTIONARY_CODES.serverAlias),
        fetcher(BANGDREAM_DICTIONARY_CODES.difficultyAlias),
      ]);
      this.serverAliasMap = this.buildServerAliasMap(serverAliasItems);
      this.difficultyAliasMap =
        this.buildDifficultyAliasMap(difficultyAliasItems);
    } catch {
      this.reset();
    }
  }

  /**
   * 解析Server。
   * @param value - 待转换值；驱动 `this.resolveServerValue()`、`serverAliasMap.get()` 的 BangDream步骤。
   * @returns BangDream 插件转换后的值。
   */
  resolveServer(value: unknown): BangDreamResolvedServer | undefined {
    const direct = this.resolveServerValue(value);
    if (direct !== undefined) return direct;
    return this.serverAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  /**
   * 解析Difficulty。
   * @param value - 待转换值；驱动 `this.resolveDifficultyValue()`、`difficultyAliasMap.get()` 的 BangDream步骤。
   * @returns BangDream 插件转换后的值。
   */
  resolveDifficulty(value: unknown): number | undefined {
    const direct = this.resolveDifficultyValue(value);
    if (direct !== undefined) return direct;
    return this.difficultyAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  /**
   * 查询 BangDream 插件数据。
   * @returns BangDream 插件查询结果。
   */
  getDefaultDisplayedServers(): BangDreamResolvedServer[] {
    return BANGDREAM_DEFAULT_SERVER_IDS.map(
      (serverId) => serverId as BangDreamResolvedServer,
    );
  }

  /**
   * 重置业务数据。
   */
  private reset() {
    this.serverAliasMap = this.buildServerAliasMap([]);
    this.difficultyAliasMap = this.buildDifficultyAliasMap([]);
  }

  /**
   * 创建 BangDream 插件对象或配置。
   * @param items - BangDream列表；驱动 `for()` 的 BangDream步骤。
   */
  private buildServerAliasMap(items: BangDreamDictionaryItem[]) {
    const map = new Map<string, BangDreamResolvedServer>();
    for (const [alias, serverCode] of Object.entries(
      BANGDREAM_DEFAULT_SERVER_ALIASES,
    )) {
      this.addServerAlias(map, alias, serverCode);
    }
    for (const item of items) {
      this.addServerDictionaryItem(map, item);
    }
    return map;
  }

  /**
   * 创建 BangDream 插件对象或配置。
   * @param items - BangDream列表；驱动 `for()` 的 BangDream步骤。
   */
  private buildDifficultyAliasMap(items: BangDreamDictionaryItem[]) {
    const map = new Map<string, number>();
    for (const [alias, difficulty] of Object.entries(
      BANGDREAM_DEFAULT_DIFFICULTY_ALIASES,
    )) {
      this.addDifficultyAlias(map, alias, difficulty);
    }
    for (const item of items) {
      this.addDifficultyDictionaryItem(map, item);
    }
    return map;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param map - map 输入；驱动 `this.addServerAlias()` 的 BangDream步骤。
   * @param item - item 输入；使用 `value`、`label` 字段生成结果。
   */
  private addServerDictionaryItem(
    map: Map<string, BangDreamResolvedServer>,
    item: BangDreamDictionaryItem,
  ) {
    const server =
      this.resolveServerValue(item.value) ??
      this.resolveServerValue(item.label);
    if (server === undefined) return;
    this.addServerAlias(map, item.label, server);
    this.addServerAlias(map, item.value, server);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param map - map 输入；驱动 `this.addDifficultyAlias()` 的 BangDream步骤。
   * @param item - item 输入；使用 `value`、`label` 字段生成结果。
   */
  private addDifficultyDictionaryItem(
    map: Map<string, number>,
    item: BangDreamDictionaryItem,
  ) {
    const difficulty =
      this.resolveDifficultyValue(item.value) ??
      this.resolveDifficultyValue(item.label);
    if (difficulty === undefined) return;
    this.addDifficultyAlias(map, item.label, difficulty);
    this.addDifficultyAlias(map, item.value, difficulty);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param map - map 输入；写入 BangDream集合、缓存或持久化状态。
   * @param alias - SQL 表别名；驱动 `normalizeDictionaryLookupKey()` 的 BangDream步骤。
   * @param server - server 输入；影响 addServerAlias 的返回值。
   */
  private addServerAlias(
    map: Map<string, BangDreamResolvedServer>,
    alias: unknown,
    server: BangDreamServerCode | BangDreamResolvedServer,
  ) {
    const normalized = normalizeDictionaryLookupKey(alias);
    if (!normalized) return;
    const value =
      typeof server === 'number'
        ? server
        : BANGDREAM_SERVER_ID_BY_CODE[server as BangDreamServerCode];
    map.set(normalized, value as BangDreamResolvedServer);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param map - map 输入；写入 BangDream集合、缓存或持久化状态。
   * @param alias - SQL 表别名；驱动 `normalizeDictionaryLookupKey()` 的 BangDream步骤。
   * @param difficulty - difficulty 输入；驱动 `map.set()` 的 BangDream步骤。
   */
  private addDifficultyAlias(
    map: Map<string, number>,
    alias: unknown,
    difficulty: number,
  ) {
    const normalized = normalizeDictionaryLookupKey(alias);
    if (!normalized) return;
    map.set(normalized, difficulty);
  }

  /**
   * 解析Server Value。
   * @param value - 待转换值；决定 BangDream条件分支。
   * @returns BangDream 插件转换后的值。
   */
  private resolveServerValue(
    value: unknown,
  ): BangDreamResolvedServer | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      return numeric as BangDreamResolvedServer;
    }
    const serverCode = raw.toLowerCase() as BangDreamServerCode;
    const serverId = BANGDREAM_SERVER_ID_BY_CODE[serverCode];
    return serverId === undefined
      ? undefined
      : (serverId as BangDreamResolvedServer);
  }

  /**
   * 解析Difficulty Value。
   * @param value - 待转换值；决定 BangDream条件分支。
   * @returns BangDream 插件转换后的值。
   */
  private resolveDifficultyValue(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      return numeric;
    }
    const normalized = raw.toLowerCase();
    const entry = Object.entries(BANGDREAM_DIFFICULTY_NAME_BY_ID).find(
      ([, name]) => name === normalized,
    );
    return entry === undefined ? undefined : Number(entry[0]);
  }
}

/**
 * 转换 BangDream 插件输入。
 * @param value - 待转换值；影响 normalizeDictionaryLookupKey 的返回值。
 */
export function normalizeDictionaryLookupKey(value: unknown) {
  return `${value || ''}`.trim().toLowerCase();
}
