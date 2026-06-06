import { Canvas, Image } from 'skia-canvas';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/asset-manifest';
import {
  BANGDREAM_TITLE_SPEC,
  createTitleTextDrawOptions,
  getTitleTextPosition,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title-spec';

let titleImage: Image;
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  titleImage = await loadImageFromPath(getBangDreamAssetPath('title'));
}
loadImageOnce();

/**
 * 在图片布局层中绘制标题。
 *
 * @param title1 - title1参数。
 * @param title2 - title2参数。
 * @returns 渲染或资源结果。
 */
export function drawTitle(title1: string, title2: string): Canvas {
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
