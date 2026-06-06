import { bestdoriApiPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import { bangDreamStaticPatchProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/static-patch-provider';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';

const mainAPI: Record<string, any> = {}; //main对象,用于存放所有api数据,数据来源于Bestdori网站

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
loadMainAPI(true).then(() => {
  logger('mainAPI', 'initializing done');
  loadMainAPI();
});

setInterval(loadMainAPI, 1000 * 60 * 5); //5分钟更新一次

export default mainAPI;
