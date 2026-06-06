import { Canvas, Image } from 'skia-canvas';
import { drawList } from './list-frame';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/asset-manifest';

interface RarityInListOptions {
  key?: string;
  rarity: number;
  trainingStatus: boolean;
  text?: string;
}

export const starList: { [type: string]: Image } = {};
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  starList.normal = await loadImageFromPath(getBangDreamAssetPath('cardStar'));
  starList.trained = await loadImageFromPath(
    getBangDreamAssetPath('cardStarTrained'),
  );
}
loadImageOnce();

/**
 * 在图片布局层中绘制RarityIn列表。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export async function drawRarityInList({
  key,
  rarity,
  trainingStatus = true,
  text,
}: RarityInListOptions): Promise<Canvas> {
  const content: Array<string | Image | Canvas> = [];
  let star: Image;
  if (rarity > 3 && trainingStatus) {
    star = starList.trained;
  } else {
    star = starList.normal;
  }
  for (let i = 0; i < rarity; i++) {
    content.push(star);
  }
  if (text) {
    content.push(text);
  }
  const canvas = drawList({
    key,
    content: content,
    textSize: 50,
    spacing: 0,
  });
  return canvas;
}
