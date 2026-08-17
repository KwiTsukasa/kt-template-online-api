import { Canvas, Image, loadImage } from 'skia-canvas';

/**
 * 按`image`、`blurRadius`读取模糊处理图片；把图片、文本或图形按布局规格绘制到画布。
 * @param image - 用于模糊处理图片的领域对象，包含 `width`、`height` 字段。
 * @param blurRadius - 决定模糊处理图片内容、边界或目标的 `blurRadius` 值。
 * @returns 模糊处理图片。
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
