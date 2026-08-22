import { Canvas, Image } from 'skia-canvas';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { loadImageFromPath } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/plugins/bangdream/src/theme/asset-manifest';
import {
  BANGDREAM_RARITY_LIST_SPEC,
  shouldUseTrainedRarityStar,
} from '@/modules/plugins/bangdream/src/domain/card/card-rarity.layout';

interface RarityInListOptions {
  key?: string;
  rarity: number;
  trainingStatus: boolean;
  text?: string;
}

export const starList: { [type: string]: Image } = {};
let rarityAssetsPreload: Promise<void> | undefined;

/**
 * 根据当前运行态处理BanG Dream卡牌RarityAssets；从受控资源来源加载所需数据（`loadImageFromPath`）。
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
 * 根据当前运行态绘制或格式化Rarity。
 * @returns 按稀有度、训练状态与可选文本绘制完成的卡牌星级列表画布。
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
