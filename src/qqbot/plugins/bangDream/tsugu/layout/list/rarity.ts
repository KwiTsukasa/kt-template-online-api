import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import * as path from 'path';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/graphics/utils';

interface RarityInListOptions {
  key?: string;
  rarity: number;
  trainingStatus: boolean;
  text?: string;
}

export const starList: { [type: string]: Image } = {};
async function loadImageOnce() {
  starList.normal = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/star.png'),
  );
  starList.trained = await loadImageFromPath(
    path.join(assetsRootPath, '/Card/star_trained.png'),
  );
}
loadImageOnce();

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
