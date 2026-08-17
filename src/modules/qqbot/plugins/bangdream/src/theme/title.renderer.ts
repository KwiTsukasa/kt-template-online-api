import { Canvas, Image } from 'skia-canvas';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import {
  BANGDREAM_TITLE_SPEC,
  createTitleTextDrawOptions,
  getTitleTextPosition,
} from '@/modules/qqbot/plugins/bangdream/src/theme/title.layout';

let titleImage: Image;
let titleImagePreload: Promise<void> | undefined;

/**
 * 根据当前运行态处理BanG DreamTitleAssets；从受控资源来源加载所需数据（`loadImageFromPath`）。
 */
export async function preloadBangDreamTitleAssets() {
  if (!titleImagePreload) {
    titleImagePreload = loadImageFromPath(getBangDreamAssetPath('title'))
      .then((image) => {
        titleImage = image;
      })
      .catch((error) => {
        titleImagePreload = undefined;
        throw error;
      });
  }
  await titleImagePreload;
}

/**
 * 根据`title1`、`title2`绘制或格式化Title；把图片、文本或图形按布局规格绘制到画布。
 * @param title1 - 决定Title内容、边界或目标的 `title1` 值。
 * @param title2 - 决定Title内容、边界或目标的 `title2` 值。
 * @returns 在预加载标题背景上绘制两段定位文本后的标题画布。
 * @throws 当 `!titleImage` 成立时拒绝当前输入并抛出 `Error`。
 */
export function drawTitle(title1: string, title2: string): Canvas {
  if (!titleImage) {
    throw new Error('BangDream 标题资源未初始化');
  }
  const canvas = new Canvas(titleImage.width, titleImage.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    titleImage,
    BANGDREAM_TITLE_SPEC.background.x,
    BANGDREAM_TITLE_SPEC.background.y,
  );
  const text1 = drawText(createTitleTextDrawOptions(title1, 'first'));
  const text2 = drawText(createTitleTextDrawOptions(title2, 'second'));
  const firstPosition = getTitleTextPosition('first');
  const secondPosition = getTitleTextPosition('second');
  ctx.drawImage(text1, firstPosition.x, firstPosition.y);
  ctx.drawImage(text2, secondPosition.x, secondPosition.y);
  return canvas;
}
