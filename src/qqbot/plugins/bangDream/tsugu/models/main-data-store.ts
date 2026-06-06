import { bestdoriApiPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import { bangDreamStaticPatchProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/static-patch-provider';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamPositiveInteger,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/runtime-options';

const mainAPI: Record<string, any> = {}; //main对象,用于存放所有api数据,数据来源于Bestdori网站
const REQUIRED_MAIN_DATA_KEYS = ['cards', 'characters', 'events', 'gacha', 'songs'];
const DEFAULT_MAIN_DATA_READY_TIMEOUT_MS = 15000;

function getMainDataReadyTimeoutMs(): number {
  return normalizeBangDreamPositiveInteger(
    process.env[BANGDREAM_TSUGU_ENV_KEYS.mainDataReadyTimeoutMs],
    DEFAULT_MAIN_DATA_READY_TIMEOUT_MS,
  );
}

function isMainDataReady(): boolean {
  return REQUIRED_MAIN_DATA_KEYS.every((key) => {
    const collection = mainAPI[key];
    return collection && Object.keys(collection).length > 0;
  });
}

async function rejectAfter(ms: number): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  throw new Error(`BangDream 主数据首次加载超时：${ms}ms`);
}

//加载mainAPI
/**
 * 在BangDream 领域模型层中加载主数据API。
 *
 * @param useCache - use缓存参数，未传入时使用默认值。
 */
async function loadMainAPI(useCache: boolean = false) {
  logger('mainAPI', 'loading mainAPI...');
  const promiseAll = Object.keys(bestdoriApiPath).map(async (key) => {
    if (useCache) {
      return (mainAPI[key] = await bangDreamBestdoriProvider.getJson(
        bestdoriApiPath[key],
        { cacheTime: 1 / 0 },
      ));
    } else {
      try {
        return (mainAPI[key] = await bangDreamBestdoriProvider.getJson(
          bestdoriApiPath[key],
        ));
      } catch {
        logger('mainAPI', `load ${key} failed`);
      }
    }
  });

  await Promise.all(promiseAll);

  const cardsCnFix = await bangDreamStaticPatchProvider.readJson<
    Record<string, unknown>
  >('cards-cn-fix.json');
  for (const key in cardsCnFix) {
    mainAPI['cards'][key] = cardsCnFix[key];
  }
  const skillsCnFix = await bangDreamStaticPatchProvider.readJson<
    Record<string, unknown>
  >('skills-cn-fix.json');
  for (const key in skillsCnFix) {
    mainAPI['skills'][key] = skillsCnFix[key];
  }
  const areaItemFix = await bangDreamStaticPatchProvider.readJson<
    Record<string, unknown>
  >('area-item-fix.json');
  for (const key in areaItemFix) {
    if (mainAPI['areaItems'][key] == undefined) {
      mainAPI['areaItems'][key] = areaItemFix[key];
    }
  }
  try {
    const songNickname = await bangDreamStaticPatchProvider.readExcelRows<{
      Id: number;
      Nickname: string;
    }>('nickname-song.xlsx');
    for (let i = 0; i < songNickname.length; i++) {
      const element = songNickname[i];
      if (mainAPI['songs'][element['Id'].toString()]) {
        mainAPI['songs'][element['Id'].toString()]['nickname'] =
          element['Nickname'];
      }
    }
  } catch {
    logger('mainAPI', '读取 nickname-song.xlsx 失败');
  }
  logger('mainAPI', 'mainAPI loaded');
}

logger('mainAPI', 'initializing...');
const initialLoadPromise = loadMainAPI(true).then(() => {
  logger('mainAPI', 'initializing done');
  loadMainAPI();
});

setInterval(loadMainAPI, 1000 * 60 * 5); //5分钟更新一次

/**
 * 等待 BangDream 主数据完成首次加载。
 */
export async function waitForMainDataReady(): Promise<void> {
  if (isMainDataReady()) {
    return;
  }
  await Promise.race([initialLoadPromise, rejectAfter(getMainDataReadyTimeoutMs())]);
  if (!isMainDataReady()) {
    throw new Error('BangDream 主数据未完成关键集合加载');
  }
}

export default mainAPI;
