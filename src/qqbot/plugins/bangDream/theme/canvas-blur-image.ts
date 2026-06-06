import { Canvas, Image, loadImage } from 'skia-canvas';

/**
 * 在底层绘图工具层中获取Blurred图片。
 *
 * @param image - 待绘制图片。
 * @param blurRadius - 模糊Radius参数。
 * @returns 异步处理结果。
 */
export async function getBlurredImage(
  image: Image,
  blurRadius: number,
): Promise<Image> {
  // 创建一个与原始图像大小相同的画布
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  // 应用模糊效果
  ctx.filter = `blur(${blurRadius}px)`;

  // 将原始图像绘制到画布上
  ctx.drawImage(image, 0, 0);

  // 将画布转换为图像
  const blurredBuffer = canvas.toBufferSync('png');
  const blurredImage = await loadImage(blurredBuffer);

  return blurredImage;
}
