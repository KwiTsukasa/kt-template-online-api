import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import * as path from 'path';
import { loadImage, Image } from 'skia-canvas';
import {
  assetsRootPath,
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import {
  globalServerPriority,
  bestdoriUrl,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import {
  loadImageFromPath,
  convertSvgToPngBuffer,
} from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';
import { BANGDREAM_SERVER_CODES } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

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

export function getServerByServerId(serverId: number): Server {
  //如果是string，则按服务器名查服务器
  if (typeof serverId == 'string') {
    serverId = getServerByName(serverId);
  }
  // 根据服务器id获取对应服务器
  return serverList[serverId];
}

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

export async function getIcon(server: Server): Promise<Image> {
  if (serverIconCache[server]) {
    return serverIconCache[server];
  }
  let image: Image;
  if (server == Server.tw) {
    image = await loadImageFromPath(path.join(assetsRootPath, 'tw.png'));
  } else {
    const iconSvgBuffer = await downloadFileCache(
      `${bestdoriUrl}/res/icon/${Server[server]}.svg`,
    );
    const iconPngBuffer = await convertSvgToPngBuffer(iconSvgBuffer);
    image = await loadImage(iconPngBuffer);
  }
  serverIconCache[server] = image;
  return image;
}

export function getServerByPriority(
  content: Array<any>,
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

export function isServer(server: any): boolean {
  if (typeof server == 'number') {
    server = Server[server];
  } else {
    return false;
  }
  return Object.keys(Server).includes(server);
}

export function isServerList(serverList: Array<any>): boolean {
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
