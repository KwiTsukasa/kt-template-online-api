import { join } from 'node:path';
import { bestdoriApiPath, bestdoriUrl } from '../../config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '../../config/runtime-options';
import {
  readBangDreamRuntimeConfig,
  requestBangDreamJson,
  writeBangDreamJsonFileAtomic,
} from '../../infrastructure/integration/runtime-io';
import {
  refreshBangDreamCatalogFromCache,
  resolveBangDreamMainDataCachePath,
  type BangDreamCatalogKey,
} from '../catalog/bangdream-catalog-cache';

export const BANGDREAM_BESTDORI_MAIN_DATA_KEYS = [
  'songs',
  'meta',
  'cards',
  'skills',
  'events',
  'gacha',
  'costumes',
  'bands',
  'characters',
  'areaItems',
] as const satisfies readonly BangDreamCatalogKey[];

type BangDreamBestdoriMainDataKey =
  (typeof BANGDREAM_BESTDORI_MAIN_DATA_KEYS)[number];

type BangDreamBestdoriMainDataSyncOutput = {
  cacheRootConfigured: boolean;
  durationMs: number;
  failedCount: number;
  successCount: number;
  syncedKeys: BangDreamBestdoriMainDataKey[];
};

/**
 * 根据当前运行态构造包含 `execute`、`handlerName`、`key` 字段的结果。
 * @returns 包含 `execute`、`handlerName`、`key` 字段的包含 `execute`、`handlerName`、`key` 字段的。
 */
export function createBestdoriMainDataSyncTask() {
  return {
    execute: syncBestdoriMainData,
    handlerName: 'syncBestdoriMainData',
    key: 'bangdream.bestdori.sync-main-data',
  };
}

/**
 * 根据`input`处理BestdoriMain数据；从 `readBangDreamRuntimeConfig` 读取BestdoriMain数据。
 * @param input - 用于BestdoriMain数据的结构化输入，包含 `keys` 字段。
 * @returns 包含 `cacheRootConfigured`、`durationMs`、`failedCount`、`successCount`、`syncedKeys` 字段的BestdoriMain数据。
 * @throws 当 `failures.length > 0` 成立时拒绝当前输入并抛出 `Error`。
 */
async function syncBestdoriMainData(
  input: Record<string, unknown>,
): Promise<BangDreamBestdoriMainDataSyncOutput> {
  const startedAt = Date.now();
  const keys = normalizeKeys(input.keys);
  const cacheRoot = resolveCacheRoot();
  const failures: Array<{ key: string; message: string }> = [];
  const syncedKeys: BangDreamBestdoriMainDataKey[] = [];

  for (const key of keys) {
    try {
      const response = await requestBangDreamJson(
        new URL(bestdoriApiPath[key], bestdoriUrl).toString(),
        { timeoutMs: 30000 },
      );
      await writeBangDreamJsonFileAtomic(
        resolveBangDreamMainDataCachePath(cacheRoot, key),
        response.body,
      );
      syncedKeys.push(key);
    } catch (error) {
      failures.push({
        key,
        message: (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return `${error}`;
        })(),
      });
    }
  }

  if (syncedKeys.length > 0) {
    await refreshBangDreamCatalogFromCache(syncedKeys);
  }

  if (failures.length > 0) {
    throw new Error(
      `BangDream Bestdori 主数据同步失败：${failures
        .map((failure) => `${failure.key}:${failure.message}`)
        .join('; ')}`,
    );
  }

  return {
    cacheRootConfigured: Boolean(
      readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot),
    ),
    durationMs: Date.now() - startedAt,
    failedCount: failures.length,
    successCount: syncedKeys.length,
    syncedKeys,
  };
}

/**
 * 将`input`规范为Keys，使等价输入得到一致表示；当 `uniqueKeys.length > 0` 成立时返回 `uniqueKeys`。
 * @param input - 用于Keys的结构化输入。
 * @returns 按输入顺序得到的Keys列表；没有匹配项时为空数组。
 */
function normalizeKeys(input: unknown): BangDreamBestdoriMainDataKey[] {
  const requested = (() => {
    if (Array.isArray(input)) {
      return input;
    }
    return [];
  })();
  const allowed = new Set<string>(BANGDREAM_BESTDORI_MAIN_DATA_KEYS);
  const keys =
    (() => {
      if (requested.length > 0) {
        return requested.filter(
          (key): key is BangDreamBestdoriMainDataKey =>
            typeof key === 'string' && allowed.has(key),
        );
      }
      return BANGDREAM_BESTDORI_MAIN_DATA_KEYS;
    })();
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length > 0) {
    return uniqueKeys;
  }
  return [...BANGDREAM_BESTDORI_MAIN_DATA_KEYS];
}

/**
 * 从当前运行态解析缓存根目录；从 `readBangDreamRuntimeConfig` 读取缓存根目录。
 * @returns 规范化后的缓存根目录；主值为空时采用 `join(process.cwd(), '.kt-workspace', 'cache', 'bang…` 兜底。
 */
function resolveCacheRoot() {
  return (
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
    join(process.cwd(), '.kt-workspace', 'cache', 'bangdream')
  );
}
