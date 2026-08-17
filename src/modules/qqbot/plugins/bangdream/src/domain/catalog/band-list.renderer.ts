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
 * 根据当前运行态绘制或格式化Band；当 `shouldUseSingleEntityLabel(content.length, text)` 成立时返回 `canvas`。
 * @returns 按乐队数量选择单项或多项布局后绘制完成的乐队列表画布。
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
