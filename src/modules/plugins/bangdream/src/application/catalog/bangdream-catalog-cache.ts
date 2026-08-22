import { join } from 'node:path';
import { bestdoriApiPath } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import { bangdreamStaticPatchProvider } from '@/modules/plugins/bangdream/src/infrastructure/storage/static-patch.provider';
import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamPositiveInteger,
} from '@/modules/plugins/bangdream/src/config/runtime-options';
import {
  readBangDreamJsonFile,
  readBangDreamRuntimeConfig,
  sleepBangDreamRuntime,
} from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

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
 * 按当前运行态读取目录Ready超时Ms；从 `readBangDreamRuntimeConfig` 读取目录Ready超时Ms。
 * @returns 目录Ready超时Ms。
 */
function getCatalogReadyTimeoutMs(): number {
  return normalizeBangDreamPositiveInteger(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.mainDataReadyTimeoutMs),
    DEFAULT_CATALOG_READY_TIMEOUT_MS,
  );
}

/**
 * 按首次出现顺序去除 BanG Dream 目录键重复项，并过滤没有 Bestdori API 路径的未知键。
 * @param keys - 决定目录Keys内容、边界或目标的 `keys` 值；省略时默认采用 `REQUIRED_CATALOG_KEYS`。
 * @returns 按输入顺序得到的目录Keys列表；没有匹配项时为空数组。
 */
function normalizeCatalogKeys(
  keys: readonly BangDreamCatalogKey[] = REQUIRED_CATALOG_KEYS,
): BangDreamCatalogKey[] {
  return [...new Set(keys)].filter((key) => key in bestdoriApiPath);
}

/**
 * 根据 `true` 判定输入是否满足条件。
 * @param key - 用于读取或更新根据 `true` 判定输入是否满足条件的稳定键。
 * @returns 满足根据 `true` 判定输入是否满足条件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isCatalogKeyReady(key: BangDreamCatalogKey): boolean {
  const collection = bangdreamCatalogCache[key];
  if (!collection) return false;
  if (typeof collection === 'object') {
    return Object.keys(collection).length > 0;
  }
  return true;
}

/**
 * 根据`keys`与当前约束判定目录Ready。
 * @param keys - 决定目录Ready内容、边界或目标的 `keys` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足目录Ready约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isCatalogReady(keys?: readonly BangDreamCatalogKey[]): boolean {
  return normalizeCatalogKeys(keys).every((key) => {
    const collection = bangdreamCatalogCache[key];
    return collection && Object.keys(collection).length > 0;
  });
}

/**
 * 在前函数此前所有接受或成功分支均未返回时抛出 `Error`，不接受无效输入。
 * @param ms - 决定在前函数此前所有接受或成功分支均未返回时抛出 `Error`，不接受无效输入内容、边界或目标的 `ms` 值。
 * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
 */
async function rejectAfter(ms: number): Promise<never> {
  await sleepBangDreamRuntime(ms);
  throw new Error(`BangDream 主数据首次加载超时：${ms}ms`);
}

/**
 * 按规范化目录键加载 BangDream 主数据，并在全部目录就绪后应用静态补丁。
 * @param keys - 决定目录数据内容、边界或目标的 `keys` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param useCache - 决定是否启用“use缓存”分支的布尔选项；省略时默认采用 `false`。
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
 * 通过 `isCatalogKeyReady` 判断输入是否满足函数约束。
 * @param key - 用于读取或更新Redis 目录键的稳定键。
 * @param useCache - 决定是否启用“use缓存”分支的布尔选项。
 * @returns Redis 目录键；没有可用结果或提前结束时为 `undefined`。
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
 * 通过 `keySet.has` 判断输入是否满足函数约束。
 * @param keys - 决定StaticPatches内容、边界或目标的 `keys` 值。
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
 * 确保目录Initial存在且保持一致；缺失时根据`keys`补齐对应状态。
 * @param keys - 决定目录Initial内容、边界或目标的 `keys` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 */
async function ensureCatalogInitialLoad(keys?: readonly BangDreamCatalogKey[]) {
  const catalogKeys = normalizeCatalogKeys(keys);
  if (isCatalogReady(catalogKeys)) return;
  logger('catalog', 'initializing...');
  await loadCatalogData(catalogKeys, true);
  logger('catalog', 'initializing done');
}

/**
 * 通过等待 BangDream 目录数据完成首次加载。
 * @param keys - 决定通过等待 BangDream 目录数据完成首次加载内容、边界或目标的 `keys` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @throws 当 `!isCatalogReady(catalogKeys)` 成立时拒绝当前输入并抛出 `Error`。
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
 * 根据`keys`处理刷新结果BanG Dream目录缓存。
 * @param keys - 决定刷新结果BanGDream目录缓存内容、边界或目标的 `keys` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
 * 按缓存根目录、`bestdori` 子目录和目录键拼接主数据 JSON 缓存路径。
 * @param cacheRoot - 必须保持在受控根目录内的缓存根目录路径。
 * @param key - 用于读取或更新按缓存根目录、`bestdori` 子目录和目录键拼接主数据 JSON 缓存路径的稳定键。
 * @returns BanGDreamMain数据缓存路径。
 */
export function resolveBangDreamMainDataCachePath(
  cacheRoot: string,
  key: BangDreamCatalogKey,
) {
  return join(cacheRoot, 'bestdori', `${key}.json`);
}

/**
 * 从当前运行态解析BanG Dream目录缓存根目录；从 `readBangDreamRuntimeConfig` 读取BanG Dream目录缓存根目录。
 * @returns 规范化后的BanGDream目录缓存根目录；主值为空时采用 `join(process.cwd(), '.kt-workspace', 'cache', 'bang…` 兜底。
 */
function resolveBangDreamCatalogCacheRoot() {
  return (
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
    join(process.cwd(), '.kt-workspace', 'cache', 'bangdream')
  );
}

/**
 * 按`key`读取BanG Dream目录数据缓存；从 `readBangDreamJsonFile` 读取BanG Dream目录数据缓存。
 * @param key - 用于读取或更新BanGDream目录数据缓存的稳定键。
 * @returns BanGDream目录数据缓存。
 */
async function readBangDreamCatalogDataFromCache(key: BangDreamCatalogKey) {
  return readBangDreamJsonFile(
    resolveBangDreamMainDataCachePath(resolveBangDreamCatalogCacheRoot(), key),
  );
}

export default bangdreamCatalogCache;
