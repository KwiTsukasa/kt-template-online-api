import { Canvas, Image } from 'skia-canvas';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import * as path from 'path';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';

let titleImage: Image;
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  titleImage = await loadImageFromPath(path.join(assetsRootPath, '/title.png'));
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
  ctx.drawImage(titleImage, 0, 0);
  const text1 = drawText({
    text: title1,
    maxWidth: 900,
    lineHeight: 50,
    textSize: 30,
    color: '#ffffff',
    font: 'old',
  });
  const text2 = drawText({
    text: title2,
    maxWidth: 900,
    lineHeight: 68,
    textSize: 40,
    color: '#5b5b5b',
    font: 'old',
  });
  ctx.drawImage(text1, 74, 0);
  ctx.drawImage(text2, 74, 42);
  return canvas;
}
