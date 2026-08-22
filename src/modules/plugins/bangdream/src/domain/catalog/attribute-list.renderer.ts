import { Attribute } from '@/modules/plugins/bangdream/src/domain/catalog/attribute.model';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas, Image } from 'skia-canvas';
import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/plugins/bangdream/src/theme/list-entity.layout';

interface AttributeInListOptions {
  key?: string;
  content: Array<Attribute>;
  text?: string;
}
/**
 * 根据当前运行态绘制或格式化卡牌属性；当 `shouldUseSingleEntityLabel(content.length, text)` 成立时返回 `canvas`。
 * @returns 卡牌属性。
 */
export async function drawAttributeInList({
  key,
  content,
  text,
}: AttributeInListOptions): Promise<Canvas> {
  const list: Array<string | Image | Canvas> = [];
  if (shouldUseSingleEntityLabel(content.length, text)) {
    list.push(await content[0].getIcon());
    list.push(content[0].name.toUpperCase());
    const canvas = drawList({
      key: key,
      content: list,
    });
    return canvas;
  } else {
    list.push(await content[0].getIcon());
    list.push(text);
    const canvas = drawList({
      key: key,
      content: list,
      spacing: BANGDREAM_ENTITY_LIST_SPEC.multiValueSpacing,
    });
    return canvas;
  }
}
