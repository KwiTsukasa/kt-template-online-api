import { createBlurredTrianglePattern } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-triangle';
import { scatterImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-scatter';
import { drawTextOnCanvas } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background-text';
import {
  loadImage,
  Image,
  Canvas,
  CanvasRenderingContext2D,
} from 'skia-canvas';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

interface BackgroundOptions {
  image?: Image | Canvas | any;
  text?: string;
  width: number;
  height: number;
}

interface TextureLike {
  height: number;
  width: number;
}

interface TextureTileOptions {
  ratio: number;
  x: number;
  y: number;
}

// 将图片等比例缩放并重复铺满整个画布,并且增加亮度
/**
 * 根据`image`、`width`、`height`处理spread背景图片；把图片、文本或图形按布局规格绘制到画布。
 * @param image - 决定spread背景图片内容、边界或目标的 `image` 值。
 * @param width - 决定spread背景图片内容、边界或目标的 `width` 值。
 * @param height - 决定spread背景图片内容、边界或目标的 `height` 值。
 * @param brightness - 决定spread背景图片内容、边界或目标的 `brightness` 值。
 * @returns spread背景图片。
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
 * 根据`image`、`brightness`处理adjustBrightness；把图片、文本或图形按布局规格绘制到画布。
 * @param image - 用于adjustBrightness的领域对象，包含 `width`、`height` 字段。
 * @param brightness - 决定adjustBrightness内容、边界或目标的 `brightness` 值。
 * @returns 逐像素增加 RGB 亮度且保持 Alpha 不变后解码得到的新图片。
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
 * 按`image`、`targetWidth`、`targetHeight`读取包含 `scaledWidth`、`scaledHeight` 字段的结果。
 * @param image - 用于包含 `scaledWidth`、`scaledHeight` 字段的结果的领域对象，包含 `width`、`height` 字段。
 * @param targetWidth - 决定包含 `scaledWidth`、`scaledHeight` 字段的结果内容、边界或目标的 `targetWidth` 值。
 * @param targetHeight - 决定包含 `scaledWidth`、`scaledHeight` 字段的结果内容、边界或目标的 `targetHeight` 值。
 * @returns 包含 `scaledWidth`、`scaledHeight` 字段的包含 `scaledWidth`、`scaledHeight` 字段的。
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
let backgroundAssetsPreload: Promise<void> | undefined;

/**
 * 根据当前运行态处理BanG Dream背景Assets；从受控资源来源加载所需数据（`loadImageFromPath`）。
 */
export async function preloadBangDreamBackgroundAssets() {
  if (!backgroundAssetsPreload) {
    backgroundAssetsPreload = Promise.all([
      loadImageFromPath(getBangDreamAssetPath('backgroundStar1')),
      loadImageFromPath(getBangDreamAssetPath('backgroundStar2')),
      loadImageFromPath(getBangDreamAssetPath('backgroundObjectBig')),
    ])
      .then(([star1, star2, texture]) => {
        star.length = 0;
        star.push(star1, star2);
        defaultBGTexture = texture;
      })
      .catch((error) => {
        backgroundAssetsPreload = undefined;
        throw error;
      });
  }
  await backgroundAssetsPreload;
}

/**
 * 根据当前运行态构造Easy背景；把图片、文本或图形按布局规格绘制到画布。
 * @returns Easy背景。
 */
export async function createEasyBackground({ width, height }) {
  await preloadBangDreamBackgroundAssets();
  const bgColor = BANGDREAM_RENDER_THEME.color.backgroundEasy;
  const canvas: Canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  const ratio = (() => {
    if (width < 2000) {
      return defaultBGTexture.width / width;
    }
    return 1;
  })();
  //将图片等比例缩放并重复铺满整个画布
  let x = 0,
    y = 0;
  while (y < height) {
    x = 0 - Math.random() * defaultBGTexture.width * ratio;
    while (x < width) {
      drawScaledTextureTile(ctx, defaultBGTexture, {
        ratio,
        x,
        y,
      });
      x += defaultBGTexture.width * ratio;
    }
    y += defaultBGTexture.height * ratio;
  }
  return canvas;
}

/**
 * 使用坐标变换绘制缩放纹理，保持 Tsugu 的比例与偏移，同时避开 skia-canvas scaled drawImage 重载在完整 Nest 进程里的 native 内存峰值。
 * @param ctx - 用于ScaledTextureTile的领域对象，包含 `save`、`translate`、`scale`、`drawImage` 字段。
 * @param texture - 决定ScaledTextureTile内容、边界或目标的 `texture` 值。
 */
export function drawScaledTextureTile(
  ctx: CanvasRenderingContext2D,
  texture: TextureLike,
  { ratio, x, y }: TextureTileOptions,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(ratio, ratio);
  ctx.drawImage(texture as Image | Canvas, 0, 0);
  ctx.restore();
}

/**
 * 通过使用业务图片生成轻量背景。
 * @returns 通过使用业务图片生成轻量背景。
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
 * 根据当前运行态构造背景；从受控资源来源加载所需数据（`loadImage`）。
 * @returns 背景。
 */
export async function createBackground({
  image,
  text,
  width,
  height,
}: BackgroundOptions): Promise<Canvas> {
  await preloadBangDreamBackgroundAssets();
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
