import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/models/character';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawList } from './list-frame';
import { Canvas, Image } from 'skia-canvas';

interface CharacterInListOptions {
  key?: string;
  content: Array<Character>;
  text?: string;
}
/**
 * 在图片布局层中绘制角色In列表。
 *
 * @param options1 - options1参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawCharacterInList(
  { key, content, text }: CharacterInListOptions,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const server = getServerByPriority(
    content[0].characterName,
    displayedServerList,
  );
  const list: Array<string | Image | Canvas> = [];
  if (content.length == 1 && text == undefined) {
    list.push(await content[0].getIcon());
    list.push(content[0].getCharacterName()[server]);
    const canvas = drawList({
      key: key,
      content: list,
    });
    return canvas;
  } else {
    for (let i = 0; i < content.length; i++) {
      const character = content[i];
      list.push(await character.getIcon());
    }
    if (text != undefined) {
      list.push(text);
    }
    const canvas = drawList({
      key: key,
      content: list,
      spacing: 0,
    });
    return canvas;
  }
}
