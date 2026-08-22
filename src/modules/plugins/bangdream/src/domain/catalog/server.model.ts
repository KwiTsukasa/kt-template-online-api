import { loadImage, Image } from 'skia-canvas';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/plugins/bangdream/src/config/runtime-config';
import { globalServerPriority } from '@/modules/plugins/bangdream/src/config/runtime-config';
import {
  loadImageFromPath,
  convertSvgToPngBuffer,
} from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { BANGDREAM_SERVER_CODES } from '@/modules/plugins/bangdream/src/domain/common/bangdream-protocol';
import { serverResourceRepository } from '@/modules/plugins/bangdream/src/domain/catalog/server-resource.repository';

export enum Server {
  jp,
  en,
  tw,
  cn,
  kr,
}

//服务器列表，因为有TW而不适用country
export const serverList: Array<Server> = BANGDREAM_SERVER_CODES.map(
  (serverCode) => Server[serverCode],
);

/**
 * 按`serverId`读取服务器标识；从 `getServerByName` 读取服务器标识。
 * @param serverId - 用于精确定位服务器的标识。
 * @returns 服务器标识。
 */
export function getServerByServerId(serverId: number): Server {
  //如果是string，则按服务器名查服务器
  if (typeof serverId == 'string') {
    serverId = getServerByName(serverId);
  }
  // 根据服务器id获取对应服务器
  return serverList[serverId];
}

/**
 * 按`name`读取服务器名称。
 * @param name - 决定服务器名称内容、边界或目标的 `name` 值。
 * @returns 服务器名称。
 */
export function getServerByName(name: string): Server {
  // 根据服务器名获取对应服务器
  let server: Server;
  server = Server[name as keyof typeof Server];
  if (server == undefined) {
    for (let i = 0; i < serverNameFullList.length; i++) {
      if (name == serverNameFullList[i]) {
        server = i;
        break;
      }
    }
  }
  return server;
}

const serverIconCache: { [server: number]: Image } = {};

/**
 * 通过 `loadImageFromPath` 加载绘制所需图片资源。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 图标。
 */
export async function getIcon(server: Server): Promise<Image> {
  if (serverIconCache[server]) {
    return serverIconCache[server];
  }
  let image: Image;
  if (server == Server.tw) {
    image = await loadImageFromPath(serverResourceRepository.getTwIconPath());
  } else {
    const iconSvgBuffer = await serverResourceRepository.getIconSvgBuffer(
      Server[server],
    );
    const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
    image = await loadImage(iconPngBuffer);
  }
  serverIconCache[server] = image;
  return image;
}

/**
 * 按`content`、`displayedServerList`读取服务器Priority；当 `content[tempServer] != null` 成立时返回 `tempServer`。
 * @param content - 用于服务器Priority的领域对象，包含 `tempServer` 字段。
 * @param displayedServerList - 决定服务器Priority内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 服务器Priority；没有可用结果或提前结束时为 `undefined`。
 */
export function getServerByPriority(
  content: Array<unknown>,
  displayedServerList: Server[] = globalDefaultServer,
) {
  const serverPriority: Server[] = [
    ...new Set([...displayedServerList, ...globalServerPriority]),
  ];
  for (let i = 0; i < serverPriority.length; i++) {
    const tempServer = serverPriority[i];
    if (content[tempServer] != null) {
      return tempServer;
    }
  }
  return undefined;
}

/**
 * 仅当输入是数字且属于 BanG Dream 已知服务器列表时返回 `true`。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 满足服务器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isServer(server: unknown): boolean {
  return typeof server === 'number' && serverList.includes(server);
}

/**
 * 通过 `isServer` 判断输入是否满足函数约束。
 * @param serverList - 用于服务器的领域对象，包含 `length`、`i` 字段。
 * @returns 满足服务器约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isServerList(serverList: Array<unknown>): boolean {
  let result = true;
  for (let i = 0; i < serverList.length; i++) {
    const element = serverList[i];
    if (!isServer(element)) {
      result = false;
      break;
    }
  }
  return result;
}
