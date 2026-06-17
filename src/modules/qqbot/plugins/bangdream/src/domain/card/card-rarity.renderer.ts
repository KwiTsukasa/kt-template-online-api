import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import {
  BANGDREAM_RARITY_LIST_SPEC,
  shouldUseTrainedRarityStar,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-rarity.layout';

interface RarityInListOptions {
  key?: string;
  rarity: number;
  trainingStatus: boolean;
  text?: string;
}

export const starList: { [type: string]: Image } = {};
let rarityAssetsPreload: Promise<void> | undefined;

/**
 * 执行 BangDream 插件流程。
 */
export async function preloadBangDreamCardRarityAssets() {
  if (!rarityAssetsPreload) {
    rarityAssetsPreload = Promise.all([
      loadImageFromPath(getBangDreamAssetPath('cardStar')),
      loadImageFromPath(getBangDreamAssetPath('cardStarTrained')),
    ])
      .then(([normal, trained]) => {
        starList.normal = normal;
        starList.trained = trained;
      })
      .catch((error) => {
        rarityAssetsPreload = undefined;
        throw error;
      });
  }
  await rarityAssetsPreload;
}

/**
 * 在图片布局层中绘制RarityIn列表。
 *
 * @param options1 - options1 输入；影响 drawRarityInList 的返回值。
 * @returns 异步处理结果。
 */
export async function drawRarityInList({
  key,
  rarity,
  trainingStatus = true,
  text,
}: RarityInListOptions): Promise<Canvas> {
  await preloadBangDreamCardRarityAssets();
  const content: Array<string | Image | Canvas> = [];
  let star: Image;
  if (shouldUseTrainedRarityStar(rarity, trainingStatus)) {
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
    textSize: BANGDREAM_RARITY_LIST_SPEC.list.textSize,
    spacing: BANGDREAM_RARITY_LIST_SPEC.list.spacing,
  });
  return canvas;
}
