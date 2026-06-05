import {
  bestdoriApiPath,
  bestdoriUrl,
  configPath,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { callAPIAndCacheResponse } from '@/qqbot/plugins/bangDream/tsugu/data/get-api';
import { readJSON } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';
import { readExcelFile } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';
import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-logger';
import * as path from 'path';

const mainAPI: object = {}; //main对象,用于存放所有api数据,数据来源于Bestdori网站

//加载mainAPI
async function loadMainAPI(useCache: boolean = false) {
  logger('mainAPI', 'loading mainAPI...');
  const promiseAll = Object.keys(bestdoriApiPath).map(async (key) => {
    if (useCache) {
      return (mainAPI[key] = await callAPIAndCacheResponse(
        bestdoriUrl + bestdoriApiPath[key],
        1 / 0,
      ));
    } else {
      try {
        return (mainAPI[key] = await callAPIAndCacheResponse(
          bestdoriUrl + bestdoriApiPath[key],
        ));
      } catch {
        logger('mainAPI', `load ${key} failed`);
      }
    }
  });

  await Promise.all(promiseAll);

  const cardsCnFix = await readJSON(path.join(configPath, 'cards-cn-fix.json'));
  for (const key in cardsCnFix) {
    mainAPI['cards'][key] = cardsCnFix[key];
  }
  const skillsCnFix = await readJSON(
    path.join(configPath, 'skills-cn-fix.json'),
  );
  for (const key in skillsCnFix) {
    mainAPI['skills'][key] = skillsCnFix[key];
  }
  const areaItemFix = await readJSON(
    path.join(configPath, 'area-item-fix.json'),
  );
  for (const key in areaItemFix) {
    if (mainAPI['areaItems'][key] == undefined) {
      mainAPI['areaItems'][key] = areaItemFix[key];
    }
  }
  try {
    const songNickname = await readExcelFile(
      path.join(configPath, 'nickname-song.xlsx'),
    );
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
