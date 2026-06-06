import {
  BANGDREAM_DIFFICULTY_NAME_BY_ID,
  BANGDREAM_SERVER_ID_BY_CODE,
  BangDreamServerCode,
} from '@/qqbot/plugins/bangDream/shared/bangdream-protocol';
import {
  BANGDREAM_DEFAULT_DIFFICULTY_ALIASES,
  BANGDREAM_DEFAULT_SERVER_ALIASES,
  BANGDREAM_DICTIONARY_CODES,
} from '@/qqbot/plugins/bangDream/dictionary/default-dictionary';
import { BANGDREAM_DEFAULT_SERVER_IDS } from '@/qqbot/plugins/bangDream/config/runtime-options';

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

  resolveServer(value: unknown): BangDreamResolvedServer | undefined {
    const direct = this.resolveServerValue(value);
    if (direct !== undefined) return direct;
    return this.serverAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  resolveDifficulty(value: unknown): number | undefined {
    const direct = this.resolveDifficultyValue(value);
    if (direct !== undefined) return direct;
    return this.difficultyAliasMap.get(normalizeDictionaryLookupKey(value));
  }

  getDefaultDisplayedServers(): BangDreamResolvedServer[] {
    return BANGDREAM_DEFAULT_SERVER_IDS.map(
      (serverId) => serverId as BangDreamResolvedServer,
    );
  }

  private reset() {
    this.serverAliasMap = this.buildServerAliasMap([]);
    this.difficultyAliasMap = this.buildDifficultyAliasMap([]);
  }

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

  private addServerDictionaryItem(
    map: Map<string, BangDreamResolvedServer>,
    item: BangDreamDictionaryItem,
  ) {
    const server =
      this.resolveServerValue(item.value) ?? this.resolveServerValue(item.label);
    if (server === undefined) return;
    this.addServerAlias(map, item.label, server);
    this.addServerAlias(map, item.value, server);
  }

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

  private addDifficultyAlias(
    map: Map<string, number>,
    alias: unknown,
    difficulty: number,
  ) {
    const normalized = normalizeDictionaryLookupKey(alias);
    if (!normalized) return;
    map.set(normalized, difficulty);
  }

  private resolveServerValue(value: unknown): BangDreamResolvedServer | undefined {
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

export function normalizeDictionaryLookupKey(value: unknown) {
  return `${value || ''}`.trim().toLowerCase();
}
