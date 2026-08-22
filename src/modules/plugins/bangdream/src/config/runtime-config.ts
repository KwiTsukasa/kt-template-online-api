import * as path from 'path';
import type { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  BANGDREAM_EVENT_STATUS_NAME,
  BANGDREAM_SERVER_LABELS,
} from '@/modules/plugins/bangdream/src/config/dictionary/default-dictionary';
import {
  BANGDREAM_DEFAULT_SERVER_IDS,
  BANGDREAM_SERVER_PRIORITY_IDS,
  BANGDREAM_TSUGU_ENV_KEYS,
  BANGDREAM_TIER_LIST_BY_SERVER,
} from '@/modules/plugins/bangdream/src/config/runtime-options';
import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import { readBangDreamRuntimeConfig } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

/**
 * 从`moduleDir`解析BanG Dream根目录；当 `path.basename(currentDir) === 'config'` 成立时返回 `path.resolve(currentDir, '..')`。
 * @param moduleDir - 决定BanGDream根目录内容、边界或目标的 `moduleDir` 值；省略时默认采用 `__dirname`。
 * @returns BanGDream根目录。
 */
export function resolveBangDreamProjectRoot(moduleDir = __dirname): string {
  const currentDir = path.resolve(moduleDir);
  if (path.basename(currentDir) === 'config') {
    return path.resolve(currentDir, '..');
  }
  return currentDir;
}

export const projectRoot: string = resolveBangDreamProjectRoot();
export const assetsRootPath: string = path.join(projectRoot, 'assets');
export const configPath: string = path.join(projectRoot, 'config', 'static');
export const fuzzySearchPath = path.join(
  configPath,
  'fuzzy-search-settings.json',
);
export const cacheRootPath: string =
  readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
  path.join(process.cwd(), '.kt-workspace', 'cache', 'bangdream');

export const bestdoriApiPath = BANGDREAM_BESTDORI_API_PATHS;
export const bestdoriUrl: string =
  readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.bestdoriBaseUrl) ||
  'https://bestdori.com';

export const hhwxUrl: string =
  readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.hhwxBaseUrl) ||
  'https://hhwx.org';
export let preferHhwxSource = false; // 是否优先使用HHWX的Tracker数据

const enableAutoTrackerDataSourceSwitch = true; // 是否开启数据源优先自动切换
const trackerAutoSwitchThreshold: number = 5; // 设定数据源自动切换门限，当存在5次数据源更新不及时的情况，自动切换数据源，加快访问速度
let trackerAutoSwitchFlags: number = 0;
/**
 * 将本次操作写入 `trackerAutoSwitchFlags`、`preferHhwxSource` 状态。
 */
export function reportDataSourceProblem() {
  if (enableAutoTrackerDataSourceSwitch) {
    if (++trackerAutoSwitchFlags > trackerAutoSwitchThreshold - 1) {
      preferHhwxSource = !preferHhwxSource;
      logger(
        'config.ts/reportDataSourceProblem',
        `Tracker数据源多次出现问题，将数据源优先切换至${(() => {
          if (preferHhwxSource) {
            return 'HHWX';
          }
          return 'Bestdori';
        })()}`,
      );
      trackerAutoSwitchFlags = 0;
    }
  }
}
/**
 * 将本次操作写入 `trackerAutoSwitchFlags` 状态。
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
