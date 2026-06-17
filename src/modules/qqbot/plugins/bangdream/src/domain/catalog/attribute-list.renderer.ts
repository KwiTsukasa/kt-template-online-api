import { Attribute } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas, Image } from 'skia-canvas';
import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-entity.layout';

interface AttributeInListOptions {
  key?: string;
  content: Array<Attribute>;
  text?: string;
}
/**
 * 在图片布局层中绘制属性In列表。
 *
 * @param options1 - options1 输入；影响 drawAttributeInList 的返回值。
 * @returns 异步处理结果。
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
