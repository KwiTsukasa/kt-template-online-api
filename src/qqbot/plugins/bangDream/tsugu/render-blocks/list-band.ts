import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import { getServerByPriority } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawList } from './list-frame';
import { Canvas, Image } from 'skia-canvas';

interface BandInListOptions {
  key?: string;
  content: Array<Band>;
  text?: string;
}
/**
 * 在图片布局层中绘制乐队In列表。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export async function drawBandInList({
  key,
  content,
  text,
}: BandInListOptions): Promise<Canvas> {
  const server = getServerByPriority(content[0].bandName);
  const list: Array<string | Image | Canvas> = [];
  if (content.length == 1 && text == undefined) {
    if (content[0].hasIcon) {
      list.push(await content[0].getIcon());
    }
    list.push(content[0].bandName[server]);
    const canvas = drawList({
      key: key,
      content: list,
    });
    return canvas;
  } else {
    for (let i = 0; i < content.length; i++) {
      const band = content[i];
      if (this.hasIcon) {
        list.push(await band.getIcon());
      } else {
        list.push(band.bandName[server]);
      }
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
