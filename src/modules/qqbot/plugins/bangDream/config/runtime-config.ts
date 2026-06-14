import * as path from 'path';
import type { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-protocol';
import {
  BANGDREAM_EVENT_STATUS_NAME,
  BANGDREAM_SERVER_LABELS,
} from '@/modules/qqbot/plugins/bangDream/dictionary/default-dictionary';
import {
  BANGDREAM_DEFAULT_SERVER_IDS,
  BANGDREAM_SERVER_PRIORITY_IDS,
  BANGDREAM_TSUGU_ENV_KEYS,
  BANGDREAM_TIER_LIST_BY_SERVER,
} from '@/modules/qqbot/plugins/bangDream/config/runtime-options';
import { logger } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-logger';

export const projectRoot: string = path.resolve(__dirname, '..');
export const assetsRootPath: string = path.join(projectRoot, 'assets');
export const configPath: string = path.join(projectRoot, 'static-config');
export const fuzzySearchPath = path.join(
  configPath,
  'fuzzy-search-settings.json',
);
export const cacheRootPath: string =
  process.env[BANGDREAM_TSUGU_ENV_KEYS.cacheRoot] ||
  path.join(process.cwd(), '.kt-workspace', 'cache', 'bangdream');

export const bestdoriApiPath = BANGDREAM_BESTDORI_API_PATHS;
export const bestdoriUrl: string =
  process.env[BANGDREAM_TSUGU_ENV_KEYS.bestdoriBaseUrl] ||
  'https://bestdori.com';

export const hhwxUrl: string =
  process.env[BANGDREAM_TSUGU_ENV_KEYS.hhwxBaseUrl] || 'https://hhwx.org';
export let preferHhwxSource = false; // 是否优先使用HHWX的Tracker数据

const enableAutoTrackerDataSourceSwitch = true; // 是否开启数据源优先自动切换
const trackerAutoSwitchThreshold: number = 5; // 设定数据源自动切换门限，当存在5次数据源更新不及时的情况，自动切换数据源，加快访问速度
let trackerAutoSwitchFlags: number = 0;
/**
 * 在运行时配置层中记录数据来源Problem。
 */
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
/**
 * 在运行时配置层中清理数据来源Problem。
 */
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
