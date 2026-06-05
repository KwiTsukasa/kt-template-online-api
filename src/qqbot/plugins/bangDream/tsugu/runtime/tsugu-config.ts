import * as path from 'path';
import type { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import {
  BANGDREAM_DEFAULT_SERVER_IDS,
  BANGDREAM_EVENT_STATUS_NAME,
  BANGDREAM_SERVER_LABELS,
  BANGDREAM_SERVER_PRIORITY_IDS,
  BANGDREAM_TIER_LIST_BY_SERVER,
} from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';
import { logger } from './tsugu-logger';

export const projectRoot: string = path.resolve(__dirname, '..');
export const assetsRootPath: string = path.join(projectRoot, 'assets');
export const configPath: string = path.join(projectRoot, 'static-config');
export const fuzzySearchPath = path.join(
  configPath,
  'fuzzy-search-settings.json',
);
export const cacheRootPath: string =
  process.env.BANGDREAM_TSUGU_CACHE_ROOT ||
  path.join(process.cwd(), '.kt-workspace', 'cache', 'bangdream');

export const bestdoriApiPath = {
  //Bestdori网站的列表api路径
  cards: '/api/cards/all.5.json',
  characters: '/api/characters/main.3.json',
  bands: '/api/bands/main.1.json',
  singer: '/api/bands/all.1.json',
  skills: '/api/skills/all.10.json',
  costumes: '/api/costumes/all.5.json',
  events: '/api/events/all.6.json',
  degrees: '/api/degrees/all.3.json',
  gacha: '/api/gacha/all.5.json',
  songs: '/api/songs/all.7.json',
  meta: '/api/songs/meta/all.5.json',
  loginCampaigns: '/api/loginCampaigns/all.5.json',
  miracleTicketExchanges: '/api/miracleTicketExchanges/all.5.json',
  comics: '/api/comics/all.5.json',
  areaItems: '/api/areaItems/main.5.json',
  rates: '/api/tracker/rates.json',
  items: '/api/misc/itemtexts.2.json',
  deco: '/api/deco/pins.all.3.json',
};
export const bestdoriUrl: string = 'https://bestdori.com'; //Bestdori网站的url

export const hhwxUrl: string = 'https://hhwx.org'; //HHWX网站的url
export let preferHhwxSource = false; // 是否优先使用HHWX的Tracker数据

const enableAutoTrackerDataSourceSwitch = true; // 是否开启数据源优先自动切换
const trackerAutoSwitchThreshold: number = 5; // 设定数据源自动切换门限，当存在5次数据源更新不及时的情况，自动切换数据源，加快访问速度
let trackerAutoSwitchFlags: number = 0;
export function reportDataSourceProblem() {
  if (enableAutoTrackerDataSourceSwitch) {
    if (++trackerAutoSwitchFlags > trackerAutoSwitchThreshold - 1) {
      preferHhwxSource = !preferHhwxSource;
      logger(
        'config.ts/reportDataSourceProblem',
        `Tracker数据源多次出现问题，将数据源优先切换至${preferHhwxSource ? 'HHWX' : 'Bestdori'}`,
      );
      trackerAutoSwitchFlags = 0;
    }
  }
}
export function clearDataSourceProblem() {
  trackerAutoSwitchFlags = 0;
}

export const globalDefaultServer: Array<Server> = [
  ...BANGDREAM_DEFAULT_SERVER_IDS,
] as unknown as Array<Server>; //默认服务器列表
export const globalServerPriority: Array<Server> = [
  ...BANGDREAM_SERVER_PRIORITY_IDS,
] as unknown as Array<Server>; //默认服务器优先级

export const serverNameFullList = [...BANGDREAM_SERVER_LABELS];

export const tierListOfServer: Record<string, readonly number[]> =
  BANGDREAM_TIER_LIST_BY_SERVER;

export const statusName: Record<string, string> = BANGDREAM_EVENT_STATUS_NAME;
