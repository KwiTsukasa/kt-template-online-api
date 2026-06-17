import { Canvas, Image, loadImage } from 'skia-canvas';

/**
 * 查询 BangDream 插件数据。
 *
 * @param image - image 输入；使用 `width`、`height` 字段生成结果。
 * @param blurRadius - BangDream列表；限定 BangDream查询范围。
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
