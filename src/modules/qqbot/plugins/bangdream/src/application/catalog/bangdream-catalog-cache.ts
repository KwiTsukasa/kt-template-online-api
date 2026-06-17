import { join } from 'node:path';
import { bestdoriApiPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import { bangdreamStaticPatchProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/static-patch.provider';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamPositiveInteger,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  readBangDreamJsonFile,
  readBangDreamRuntimeConfig,
  sleepBangDreamRuntime,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export type BangDreamCatalogKey = keyof typeof bestdoriApiPath;

const bangdreamCatalogCache: Record<string, any> = Object.fromEntries(
  Object.keys(bestdoriApiPath).map((key) => [key, {}]),
);
const REQUIRED_CATALOG_KEYS = [
  'songs',
] as const satisfies readonly BangDreamCatalogKey[];
const DEFAULT_CATALOG_READY_TIMEOUT_MS = 15000;
const catalogLoadPromises = new Map<BangDreamCatalogKey, Promise<void>>();

/**
 * 查询 BangDream 插件数据。
 * @returns BangDream 插件查询结果。
 */
function getCatalogReadyTimeoutMs(): number {
  return normalizeBangDreamPositiveInteger(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.mainDataReadyTimeoutMs),
    DEFAULT_CATALOG_READY_TIMEOUT_MS,
  );
}

/**
 * 转换 BangDream 插件输入。
 * @param keys - BangDream列表；去重列表值。
 * @returns BangDream 插件转换后的值。
 */
function normalizeCatalogKeys(
  keys: readonly BangDreamCatalogKey[] = REQUIRED_CATALOG_KEYS,
): BangDreamCatalogKey[] {
  return [...new Set(keys)].filter((key) => key in bestdoriApiPath);
}

/**
 * 判断 BangDream 插件条件。
 * @param key - 键名；计算 BangDream判断结果。
 * @returns 布尔值，表示 BangDream 插件条件是否满足。
 */
function isCatalogKeyReady(key: BangDreamCatalogKey): boolean {
  const collection = bangdreamCatalogCache[key];
  if (!collection) return false;
  return typeof collection === 'object'
    ? Object.keys(collection).length > 0
    : true;
}

/**
 * 判断 BangDream 插件条件。
 * @param keys - BangDream列表；驱动 `normalizeCatalogKeys()` 的 BangDream步骤。
 * @returns 布尔值，表示 BangDream 插件条件是否满足。
 */
function isCatalogReady(keys?: readonly BangDreamCatalogKey[]): boolean {
  return normalizeCatalogKeys(keys).every((key) => {
    const collection = bangdreamCatalogCache[key];
    return collection && Object.keys(collection).length > 0;
  });
}

/**
 * 执行 BangDream 插件流程。
 * @param ms - 等待毫秒数；驱动 `sleepBangDreamRuntime()` 的 BangDream步骤。
 */
async function rejectAfter(ms: number): Promise<never> {
  await sleepBangDreamRuntime(ms);
  throw new Error(`BangDream 主数据首次加载超时：${ms}ms`);
}

/**
 * 加载 BangDream 领域目录数据。
 *
 * @param useCache - useCache 输入；驱动 `loadCatalogKey()` 的 BangDream步骤。
 */
async function loadCatalogData(
  keys?: readonly BangDreamCatalogKey[],
  useCache: boolean = false,
) {
  const catalogKeys = normalizeCatalogKeys(keys);
  logger('catalog', 'loading catalog...');

  for (const key of catalogKeys) {
    await loadCatalogKey(key, useCache);
  }

  await applyStaticPatches(catalogKeys);
  logger('catalog', 'catalog loaded');
}

/**
 * 加载Catalog Key。
 * @param key - 键名；驱动 `catalogLoadPromises.get()`、`readBangDreamCatalogDataFromCache()`、`bangdreamBestdoriProvider.getJson()`、`catalogLoadPromises.set()` 的 BangDream步骤。
 * @param useCache - useCache 输入；决定 BangDream条件分支。
 */
async function loadCatalogKey(key: BangDreamCatalogKey, useCache: boolean) {
  if (isCatalogKeyReady(key)) return;
  const pending = catalogLoadPromises.get(key);
  if (pending) return await pending;

  const promise = (async () => {
    if (useCache) {
      try {
        bangdreamCatalogCache[key] =
          await readBangDreamCatalogDataFromCache(key);
      } catch {
        bangdreamCatalogCache[key] = await bangdreamBestdoriProvider.getJson(
          bestdoriApiPath[key],
          {
            cacheTime: 1 / 0,
          },
        );
      }
      return;
    }

    try {
      bangdreamCatalogCache[key] = await bangdreamBestdoriProvider.getJson(
        bestdoriApiPath[key],
      );
    } catch {
      logger('catalog', `load ${key} failed`);
    }
  })();
  catalogLoadPromises.set(key, promise);
  try {
    await promise;
  } finally {
    catalogLoadPromises.delete(key);
  }
}

/**
 * 执行 BangDream 插件流程。
 * @param keys - BangDream列表；去重列表值。
 */
async function applyStaticPatches(keys: readonly BangDreamCatalogKey[]) {
  const keySet = new Set(keys);
  if (keySet.has('cards')) {
    const cardsCnFix =
      await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
        'cards-cn-fix.json',
      );
    for (const key in cardsCnFix) {
      bangdreamCatalogCache['cards'][key] = cardsCnFix[key];
    }
  }
  if (keySet.has('skills')) {
    const skillsCnFix =
      await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
        'skills-cn-fix.json',
      );
    for (const key in skillsCnFix) {
      bangdreamCatalogCache['skills'][key] = skillsCnFix[key];
    }
  }
  if (keySet.has('areaItems')) {
    const areaItemFix =
      await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
        'area-item-fix.json',
      );
    for (const key in areaItemFix) {
      if (bangdreamCatalogCache['areaItems'][key] == undefined) {
        bangdreamCatalogCache['areaItems'][key] = areaItemFix[key];
      }
    }
  }
  if (keySet.has('songs')) {
    try {
      const songNickname = await bangdreamStaticPatchProvider.readExcelRows<{
        Id: number;
        Nickname: string;
      }>('nickname-song.xlsx');
      for (let i = 0; i < songNickname.length; i++) {
        const element = songNickname[i];
        if (bangdreamCatalogCache['songs'][element['Id'].toString()]) {
          bangdreamCatalogCache['songs'][element['Id'].toString()]['nickname'] =
            element['Nickname'];
        }
      }
    } catch {
      logger('catalog', '读取 nickname-song.xlsx 失败');
    }
  }
}

/**
 * 确保Catalog Initial Load。
 * @param keys - BangDream列表；驱动 `normalizeCatalogKeys()` 的 BangDream步骤。
 */
async function ensureCatalogInitialLoad(keys?: readonly BangDreamCatalogKey[]) {
  const catalogKeys = normalizeCatalogKeys(keys);
  if (isCatalogReady(catalogKeys)) return;
  logger('catalog', 'initializing...');
  await loadCatalogData(catalogKeys, true);
  logger('catalog', 'initializing done');
}

/**
 * 等待 BangDream 目录数据完成首次加载。
 */
export async function waitForBangDreamCatalogReady(
  keys?: readonly BangDreamCatalogKey[],
): Promise<void> {
  const catalogKeys = normalizeCatalogKeys(keys);
  if (isCatalogReady(catalogKeys)) {
    return;
  }
  await Promise.race([
    ensureCatalogInitialLoad(catalogKeys),
    rejectAfter(getCatalogReadyTimeoutMs()),
  ]);
  if (!isCatalogReady(catalogKeys)) {
    throw new Error('BangDream 主数据未完成关键集合加载');
  }
}

/**
 * 执行 BangDream 插件流程。
 * @param keys - BangDream列表；驱动 `normalizeCatalogKeys()` 的 BangDream步骤。
 */
export async function refreshBangDreamCatalogFromCache(
  keys?: readonly BangDreamCatalogKey[],
) {
  const catalogKeys = normalizeCatalogKeys(keys);
  for (const key of catalogKeys) {
    bangdreamCatalogCache[key] = {};
  }
  await loadCatalogData(catalogKeys, true);
}

/**
 * 解析Bang Dream Main Data Cache Path。
 * @param cacheRoot - cacheRoot 输入；驱动 `join()` 的 BangDream步骤。
 * @param key - 键名；影响 resolveBangDreamMainDataCachePath 的返回值。
 */
export function resolveBangDreamMainDataCachePath(
  cacheRoot: string,
  key: BangDreamCatalogKey,
) {
  return join(cacheRoot, 'bestdori', `${key}.json`);
}

/**
 * 解析Bang Dream Catalog Cache Root。
 */
function resolveBangDreamCatalogCacheRoot() {
  return (
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
    join(process.cwd(), '.kt-workspace', 'cache', 'bangdream')
  );
}

/**
 * 读取 BangDream 插件资源。
 * @param key - 键名；驱动 `readBangDreamJsonFile()` 的 BangDream步骤。
 */
async function readBangDreamCatalogDataFromCache(key: BangDreamCatalogKey) {
  return readBangDreamJsonFile(
    resolveBangDreamMainDataCachePath(resolveBangDreamCatalogCacheRoot(), key),
  );
}

export default bangdreamCatalogCache;
