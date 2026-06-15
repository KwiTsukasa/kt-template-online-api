import { bestdoriApiPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import { bangdreamStaticPatchProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/static-patch.provider';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamPositiveInteger,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  readBangDreamRuntimeConfig,
  sleepBangDreamRuntime,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

const bangdreamCatalogCache: Record<string, any> = {};
const REQUIRED_CATALOG_KEYS = [
  'cards',
  'characters',
  'events',
  'gacha',
  'songs',
];
const DEFAULT_CATALOG_READY_TIMEOUT_MS = 15000;

function getCatalogReadyTimeoutMs(): number {
  return normalizeBangDreamPositiveInteger(
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.mainDataReadyTimeoutMs),
    DEFAULT_CATALOG_READY_TIMEOUT_MS,
  );
}

function isCatalogReady(): boolean {
  return REQUIRED_CATALOG_KEYS.every((key) => {
    const collection = bangdreamCatalogCache[key];
    return collection && Object.keys(collection).length > 0;
  });
}

async function rejectAfter(ms: number): Promise<never> {
  await sleepBangDreamRuntime(ms);
  throw new Error(`BangDream 主数据首次加载超时：${ms}ms`);
}

/**
 * 加载 BangDream 领域目录数据。
 *
 * @param useCache - use缓存参数，未传入时使用默认值。
 */
async function loadCatalogData(useCache: boolean = false) {
  logger('catalog', 'loading catalog...');
  const promiseAll = Object.keys(bestdoriApiPath).map(async (key) => {
    if (useCache) {
      return (bangdreamCatalogCache[key] =
        await bangdreamBestdoriProvider.getJson(bestdoriApiPath[key], {
          cacheTime: 1 / 0,
        }));
    } else {
      try {
        return (bangdreamCatalogCache[key] =
          await bangdreamBestdoriProvider.getJson(bestdoriApiPath[key]));
      } catch {
        logger('catalog', `load ${key} failed`);
      }
    }
  });

  await Promise.all(promiseAll);

  const cardsCnFix =
    await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
      'cards-cn-fix.json',
    );
  for (const key in cardsCnFix) {
    bangdreamCatalogCache['cards'][key] = cardsCnFix[key];
  }
  const skillsCnFix =
    await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
      'skills-cn-fix.json',
    );
  for (const key in skillsCnFix) {
    bangdreamCatalogCache['skills'][key] = skillsCnFix[key];
  }
  const areaItemFix =
    await bangdreamStaticPatchProvider.readJson<Record<string, unknown>>(
      'area-item-fix.json',
    );
  for (const key in areaItemFix) {
    if (bangdreamCatalogCache['areaItems'][key] == undefined) {
      bangdreamCatalogCache['areaItems'][key] = areaItemFix[key];
    }
  }
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
  logger('catalog', 'catalog loaded');
}

let initialLoadPromise: Promise<void> | undefined;

function ensureCatalogInitialLoad() {
  if (!initialLoadPromise) {
    logger('catalog', 'initializing...');
    initialLoadPromise = loadCatalogData(true).then(async () => {
      logger('catalog', 'initializing done');
      await loadCatalogData();
    });
  }
  return initialLoadPromise;
}

/**
 * 等待 BangDream 目录数据完成首次加载。
 */
export async function waitForBangDreamCatalogReady(): Promise<void> {
  if (isCatalogReady()) {
    return;
  }
  await Promise.race([
    ensureCatalogInitialLoad(),
    rejectAfter(getCatalogReadyTimeoutMs()),
  ]);
  if (!isCatalogReady()) {
    throw new Error('BangDream 主数据未完成关键集合加载');
  }
}

export default bangdreamCatalogCache;
