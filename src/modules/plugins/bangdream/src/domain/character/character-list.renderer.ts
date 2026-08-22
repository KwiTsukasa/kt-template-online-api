import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { Character } from '@/modules/plugins/bangdream/src/domain/character/character.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas, Image } from 'skia-canvas';
import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/plugins/bangdream/src/theme/list-entity.layout';

interface CharacterInListOptions {
  key?: string;
  content: Array<Character>;
  text?: string;
}
/**
 * 根据`displayedServerList`绘制或格式化角色；当 `shouldUseSingleEntityLabel(content.length, text)` 成立时返回 `canvas`。
 * @param displayedServerList - 决定角色内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 角色。
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
  if (shouldUseSingleEntityLabel(content.length, text)) {
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
      spacing: BANGDREAM_ENTITY_LIST_SPEC.multiValueSpacing,
    });
    return canvas;
  }
}
