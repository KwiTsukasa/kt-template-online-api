import { createBlurredTrianglePattern } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-triangle';
import { scatterImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-scatter';
import { drawTextOnCanvas } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-text';
import { loadImage, Image, Canvas } from 'skia-canvas';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

interface BackgroundOptions {
  image?: Image | Canvas | any;
  text?: string;
  width: number;
  height: number;
}

// 将图片等比例缩放并重复铺满整个画布,并且增加亮度
/**
 * 在底层绘图工具层中处理spreadBackground图片。
 *
 * @param image - 待绘制图片。
 * @param width - 绘制宽度。
 * @param height - 绘制高度。
 * @param brightness - brightness参数。
 * @returns 异步处理结果。
 */
async function spreadBackgroundImage(
  image: Image,
  width: number,
  height: number,
  brightness: number,
): Promise<Buffer> {
  const canvas: Canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  // 调整亮度
  const brightenedImage = await adjustBrightness(image, brightness);

  // 计算缩放后的尺寸
  const { scaledWidth, scaledHeight } = getScaledDimensions(
    brightenedImage,
    width,
    height,
  );

  // 绘制图像
  for (let y = 0; y < height; y += scaledHeight) {
    for (let x = 0; x < width; x += scaledWidth) {
      ctx.drawImage(brightenedImage, x, y, scaledWidth, scaledHeight);
    }
  }

  return canvas.toBufferSync('png');
}

/**
 * 在底层绘图工具层中处理adjustBrightness。
 *
 * @param image - 待绘制图片。
 * @param brightness - brightness参数。
 * @returns 异步处理结果。
 */
async function adjustBrightness(
  image: Image,
  brightness: number,
): Promise<Image> {
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0, image.width, image.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const factor = brightness / 255;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] + 255 * factor); // Red
    data[i + 1] = Math.min(255, data[i + 1] + 255 * factor); // Green
    data[i + 2] = Math.min(255, data[i + 2] + 255 * factor); // Blue
    // Alpha (data[i + 3]) remains unchanged
  }

  ctx.putImageData(imageData, 0, 0);

  return await loadImage(canvas.toBufferSync('png'));
}

/**
 * 在底层绘图工具层中获取ScaledDimensions。
 *
 * @param image - 待绘制图片。
 * @param targetWidth - target宽度参数。
 * @param targetHeight - target高度参数。
 * @returns 计算后的数值。
 */
function getScaledDimensions(
  image: Image,
  targetWidth: number,
  targetHeight: number,
): { scaledWidth: number; scaledHeight: number } {
  const imageAspectRatio = image.width / image.height;
  const canvasAspectRatio = targetWidth / targetHeight;
  let scaledWidth: number, scaledHeight: number;

  if (imageAspectRatio > canvasAspectRatio) {
    scaledWidth = targetWidth;
    scaledHeight = image.height * (targetWidth / image.width);
  } else {
    scaledHeight = targetHeight;
    scaledWidth = image.width * (targetHeight / image.height);
  }

  return { scaledWidth, scaledHeight };
}

const star: Image[] = [];

let defaultBGTexture: Image;
/**
 * 在底层绘图工具层中加载图片Once。
 */
async function loadImageOnce() {
  star.push(await loadImageFromPath(getBangDreamAssetPath('backgroundStar1')));
  star.push(await loadImageFromPath(getBangDreamAssetPath('backgroundStar2')));
  defaultBGTexture = await loadImageFromPath(
    getBangDreamAssetPath('backgroundObjectBig'),
  );
}
loadImageOnce();

/**
 * 在底层绘图工具层中创建简易Background。
 *
 * @param options1 - options1参数。
 */
export async function createEasyBackground({ width, height }) {
  const bgColor = BANGDREAM_RENDER_THEME.color.backgroundEasy;
  const canvas: Canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  const ratio = width < 2000 ? defaultBGTexture.width / width : 1;
  //将图片等比例缩放并重复铺满整个画布
  let x = 0,
    y = 0;
  while (y < height) {
    x = 0 - Math.random() * defaultBGTexture.width * ratio;
    while (x < width) {
      ctx.drawImage(
        defaultBGTexture,
        x,
        y,
        defaultBGTexture.width * ratio,
        defaultBGTexture.height * ratio,
      );
      x += defaultBGTexture.width * ratio;
    }
    y += defaultBGTexture.height * ratio;
  }
  return canvas;
}

/**
 * 使用业务图片生成轻量背景。
 *
 * @param options1 - 背景参数。
 */
export async function createImageBackground({
  image,
  width,
  height,
}: BackgroundOptions): Promise<Canvas> {
  const backgroundBuffer = await spreadBackgroundImage(
    image,
    width,
    height,
    40,
  );
  const backgroundImage = await loadImage(backgroundBuffer);
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(backgroundImage, 0, 0);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillRect(0, 0, width, height);

  return canvas;
}

/**
 * 在底层绘图工具层中创建Background。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export async function createBackground({
  image,
  text,
  width,
  height,
}: BackgroundOptions): Promise<Canvas> {
  //将图片铺满画面，并且增加20亮度
  const backgroundBuffer = await spreadBackgroundImage(
    image,
    width,
    height,
    20,
  );
  const backgroundImage = await loadImage(backgroundBuffer);

  //给图片增加三角形纹理
  const canvas = await createBlurredTrianglePattern({
    image: backgroundImage,
    blurRadius: 100,
    triangleSize: 200,
    brightnessDifference: 0.04,
  });

  //添加随机星星
  for (let i = 0; i < star.length; i++) {
    await scatterImages({
      canvas,
      image: star[i],
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      density: 0.00001,
      angleRange: 72,
      sizeRange: [25, 75],
    });
  }

  //添加背景文字
  drawTextOnCanvas(canvas, {
    text: (text ??= 'BanG Dream!'),
    fontSize: 150,
    angle: 15,
    lineSpacing: 50,
    letterSpacing: 100,
    strokeWidth: 3,
    skewAngle: -12,
    opacity: 0.5,
    scaleX: 0.8,
  });
  return canvas;
}
