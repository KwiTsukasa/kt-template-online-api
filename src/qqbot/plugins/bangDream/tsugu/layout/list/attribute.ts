import { Attribute } from '@/qqbot/plugins/bangDream/tsugu/domain/attribute';
import { drawList } from '../list';
import { Canvas, Image } from 'skia-canvas';

interface AttributeInListOptions {
  key?: string;
  content: Array<Attribute>;
  text?: string;
}
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
