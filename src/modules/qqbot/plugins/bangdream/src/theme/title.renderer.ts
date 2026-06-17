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
 * 执行 BangDream 插件流程。
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
 * 在图片布局层中绘制标题。
 *
 * @param title1 - title1 输入；驱动 `drawText()` 的 BangDream步骤。
 * @param title2 - title2 输入；驱动 `drawText()` 的 BangDream步骤。
 * @returns 渲染或资源结果。
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
