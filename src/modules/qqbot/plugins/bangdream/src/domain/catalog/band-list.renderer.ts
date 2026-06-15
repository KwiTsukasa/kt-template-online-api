import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import { getServerByPriority } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas, Image } from 'skia-canvas';
import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-entity.layout';

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
  if (shouldUseSingleEntityLabel(content.length, text)) {
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
      if (band.hasIcon) {
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
      spacing: BANGDREAM_ENTITY_LIST_SPEC.multiValueSpacing,
    });
    return canvas;
  }
}
