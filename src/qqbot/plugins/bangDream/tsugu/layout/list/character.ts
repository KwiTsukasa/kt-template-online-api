import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { Canvas, Image } from 'skia-canvas';

interface CharacterInListOptions {
  key?: string;
  content: Array<Character>;
  text?: string;
}
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
