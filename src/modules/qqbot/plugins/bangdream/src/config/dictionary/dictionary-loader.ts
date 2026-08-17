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
   * 根据`fetcher`处理刷新结果；当 `!fetcher` 成立时直接结束且不产生返回值。
   * @param fetcher - 负责完成刷新结果外部交互的受控能力；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
   * 从`value`解析服务器；从 `serverAliasMap.get` 读取服务器。
   * @param value - 参与服务器比较、格式化或输出的候选值。
   * @returns 服务器。
   */
  resolveServer(value: unknown): BangDreamResolvedServer | undefined {
    const direct = this.resolveServerValue(value);
    if (direct !== undefined) return direct;
    return this.serverAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  /**
   * 从`value`解析难度；从 `difficultyAliasMap.get` 读取难度。
   * @param value - 参与难度比较、格式化或输出的候选值。
   * @returns 难度。
   */
  resolveDifficulty(value: unknown): number | undefined {
    const direct = this.resolveDifficultyValue(value);
    if (direct !== undefined) return direct;
    return this.difficultyAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  /**
   * 按当前运行态读取DisplayedServers。
   * @returns 按输入顺序得到的DisplayedServers列表；没有匹配项时为空数组。
   */
  getDefaultDisplayedServers(): BangDreamResolvedServer[] {
    return BANGDREAM_DEFAULT_SERVER_IDS.map(
      (serverId) => serverId as BangDreamResolvedServer,
    );
  }

  /**
   * 根据当前运行态处理reset。
   */
  private reset() {
    this.serverAliasMap = this.buildServerAliasMap([]);
    this.difficultyAliasMap = this.buildDifficultyAliasMap([]);
  }

  /**
   * 根据`items`构造服务器别名映射。
   * @param items - 按原有顺序参与服务器别名映射筛选、合并或汇总的集合。
   * @returns 服务器别名映射。
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
   * 根据`items`构造难度别名映射。
   * @param items - 按原有顺序参与难度别名映射筛选、合并或汇总的集合。
   * @returns 难度别名映射。
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
   * 根据`map`、`item`更新服务器Dictionary条目。
   * @param map - 决定服务器Dictionary条目内容、边界或目标的 `map` 值。
   * @param item - 用于服务器Dictionary条目的领域对象，包含 `value`、`label` 字段。
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
   * 根据`map`、`item`更新难度Dictionary条目。
   * @param map - 决定难度Dictionary条目内容、边界或目标的 `map` 值。
   * @param item - 用于难度Dictionary条目的领域对象，包含 `value`、`label` 字段。
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
   * 通过 `normalizeDictionaryLookupKey` 生成稳定标识。
   * @param map - 用于服务器别名映射的领域对象，包含 `set` 字段。
   * @param alias - 决定服务器别名映射内容、边界或目标的 `alias` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   */
  private addServerAlias(
    map: Map<string, BangDreamResolvedServer>,
    alias: unknown,
    server: BangDreamServerCode | BangDreamResolvedServer,
  ) {
    const normalized = normalizeDictionaryLookupKey(alias);
    if (!normalized) return;
    const value =
      (() => {
        if (typeof server === 'number') {
          return server;
        }
        return BANGDREAM_SERVER_ID_BY_CODE[server as BangDreamServerCode];
      })();
    map.set(normalized, value as BangDreamResolvedServer);
  }

  /**
   * 通过 `normalizeDictionaryLookupKey` 生成稳定标识。
   * @param map - 用于难度别名映射的领域对象，包含 `set` 字段。
   * @param alias - 决定难度别名映射内容、边界或目标的 `alias` 值。
   * @param difficulty - 决定难度别名映射内容、边界或目标的 `difficulty` 值。
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
   * 从`value`解析服务器值；当 `Number.isInteger(numeric) && numeric >= 0 && numeric <= 4` 成立时返回 `numeric as BangDreamResolvedServer`。
   * @param value - 参与服务器值比较、格式化或输出的候选值。
   * @returns 服务器值；没有可用结果或提前结束时为 `undefined`。
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
    if (serverId === undefined) {
      return undefined;
    }
    return (serverId as BangDreamResolvedServer);
  }

  /**
   * 从`value`解析难度值；当 `Number.isInteger(numeric) && numeric >= 0 && numeric <= 4` 成立时返回 `numeric`。
   * @param value - 参与难度值比较、格式化或输出的候选值。
   * @returns 难度值；没有可用结果或提前结束时为 `undefined`。
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
    if (entry === undefined) {
      return undefined;
    }
    return Number(entry[0]);
  }
}

/**
 * 将`value`规范为DictionaryLookup键，使等价输入得到一致表示。
 * @param value - 待转换为DictionaryLookup键的原始值。
 * @returns DictionaryLookup键。
 */
export function normalizeDictionaryLookupKey(value: unknown) {
  return `${value || ''}`.trim().toLowerCase();
}
