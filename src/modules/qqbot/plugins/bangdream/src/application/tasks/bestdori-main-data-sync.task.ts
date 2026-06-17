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
 * 创建 BangDream 插件对象或配置。
 */
export function createBestdoriMainDataSyncTask() {
  return {
    /**
     * 执行 Bestdori 主数据同步任务。
     */
    execute: syncBestdoriMainData,
    handlerName: 'syncBestdoriMainData',
    key: 'bangdream.bestdori.sync-main-data',
  };
}

/**
 * 更新 BangDream 插件状态。
 * @param input - input 输入；使用 `keys` 字段生成结果。
 * @returns BangDream 插件更新后的状态。
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
        message: error instanceof Error ? error.message : `${error}`,
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
 * 转换 BangDream 插件输入。
 * @param input - input 输入；驱动 `Array.isArray()` 的 BangDream步骤。
 * @returns BangDream 插件转换后的值。
 */
function normalizeKeys(input: unknown): BangDreamBestdoriMainDataKey[] {
  const requested = Array.isArray(input) ? input : [];
  const allowed = new Set<string>(BANGDREAM_BESTDORI_MAIN_DATA_KEYS);
  const keys =
    requested.length > 0
      ? requested.filter(
          (key): key is BangDreamBestdoriMainDataKey =>
            typeof key === 'string' && allowed.has(key),
        )
      : BANGDREAM_BESTDORI_MAIN_DATA_KEYS;
  const uniqueKeys = [...new Set(keys)];
  return uniqueKeys.length > 0
    ? uniqueKeys
    : [...BANGDREAM_BESTDORI_MAIN_DATA_KEYS];
}

/**
 * 解析Cache Root。
 */
function resolveCacheRoot() {
  return (
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
    join(process.cwd(), '.kt-workspace', 'cache', 'bangdream')
  );
}
