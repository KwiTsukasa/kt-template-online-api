import { Attribute } from '@/qqbot/plugins/bangDream/tsugu/models/attribute';
import { drawList } from './list-frame';
import { Canvas, Image } from 'skia-canvas';

interface AttributeInListOptions {
  key?: string;
  content: Array<Attribute>;
  text?: string;
}
/**
 * 在图片布局层中绘制属性In列表。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export async function drawAttributeInList({
  key,
  content,
  text,
}: AttributeInListOptions): Promise<Canvas> {
  const list: Array<string | Image | Canvas> = [];
  if (content.length == 1 && text == undefined) {
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
      spacing: 0,
    });
    return canvas;
  }
}
