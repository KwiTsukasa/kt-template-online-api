import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas, Image } from 'skia-canvas';
import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-entity.layout';

interface CharacterInListOptions {
  key?: string;
  content: Array<Character>;
  text?: string;
}
/**
 * 在图片布局层中绘制角色In列表。
 *
 * @param options1 - options1 输入；影响 drawCharacterInList 的返回值。
 * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
