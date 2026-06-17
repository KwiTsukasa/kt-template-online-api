import { loadImage, Image } from 'skia-canvas';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { globalServerPriority } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import {
  loadImageFromPath,
  convertSvgToPngBuffer,
} from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { BANGDREAM_SERVER_CODES } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import { serverResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server-resource.repository';

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
 * 在BangDream 领域模型层中获取服务器By服务器ID。
 *
 * @param serverId - 服务器 ID；定位本次读取、更新、删除或关联的服务器。
 * @returns BangDream 插件查询结果。
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
 * 在BangDream 领域模型层中获取服务器By名称。
 *
 * @param name - 名称文本；决定 BangDream条件分支。
 * @returns BangDream 插件查询结果。
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
 * 在BangDream 领域模型层中获取图标。
 *
 * @param server - server 输入；驱动 `serverResourceRepository.getIconSvgBuffer()` 的 BangDream步骤。
 * @returns 异步处理结果。
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
 * 在BangDream 领域模型层中获取服务器ByPriority。
 *
 * @param content - 待处理内容；决定 BangDream条件分支。
 * @param displayedServerList - displayedServerList 输入；去重列表值。
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
 * 在BangDream 领域模型层中判断服务器。
 *
 * @param server - server 输入；驱动 `serverList.includes()` 的 BangDream步骤。
 * @returns 判断结果。
 */
export function isServer(server: unknown): boolean {
  return typeof server === 'number' && serverList.includes(server);
}

/**
 * 在BangDream 领域模型层中判断服务器列表。
 *
 * @param serverList - serverList 输入；使用 `length` 字段计算判断结果。
 * @returns 判断结果。
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
