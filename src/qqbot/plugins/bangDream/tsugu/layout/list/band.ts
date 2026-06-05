import { Band } from '@/qqbot/plugins/bangDream/tsugu/domain/band';
import { getServerByPriority } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawList } from '../list';
import { Canvas, Image } from 'skia-canvas';

interface BandInListOptions {
  key?: string;
  content: Array<Band>;
  text?: string;
}
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
