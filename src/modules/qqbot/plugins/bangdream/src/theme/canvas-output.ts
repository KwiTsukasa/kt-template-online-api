import { Canvas, Image } from 'skia-canvas';
import {
  createBackground,
  createEasyBackground,
  createImageBackground,
} from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';

let BGDefaultImage: Image;
let outputAssetsPreload: Promise<void> | undefined;

/**
 * 执行 BangDream 插件流程。
 */
export async function preloadBangDreamOutputAssets() {
  if (!outputAssetsPreload) {
    outputAssetsPreload = loadImageFromPath(
      getBangDreamAssetPath('backgroundLive'),
    )
      .then((image) => {
        BGDefaultImage = image;
      })
      .catch((error) => {
        outputAssetsPreload = undefined;
        throw error;
      });
  }
  await outputAssetsPreload;
}

export interface OutputFinalOptions {
  startWithSpace?: boolean;
  imageList: Array<Image | Canvas>;
  useEasyBG?: boolean;
  useImageBG?: boolean;
  text?: string;
  BGimage?: Image | Canvas;
  compress?: boolean;
}

export type FinalImageRenderOptions = Omit<OutputFinalOptions, 'imageList'>;

//将图片列表从上到下叠在一起输出为一张图片
/**
 * 在底层绘图工具层中输出最终画布。
 *
 * @param options - BangDream列表；影响 outputFinalCanv 的返回值。
 * @returns 异步处理结果。
 */
export const outputFinalCanv = async function outputFinalCanv({
  imageList,
  startWithSpace = true,
  useEasyBG = true,
  useImageBG = false,
  text = 'BanG Dream!',
  BGimage,
}: OutputFinalOptions): Promise<Canvas> {
  await preloadBangDreamOutputAssets();
  const backgroundImage = BGimage ?? BGDefaultImage;
  let allH = 30;
  if (startWithSpace) {
    allH += 50;
  }
  let maxW = 0;
  for (let i = 0; i < imageList.length; i++) {
    allH = allH + imageList[i].height;
    allH += 30;
    if (imageList[i].width > maxW) {
      maxW = imageList[i].width;
    }
  }
  const tempCanvas = new Canvas(maxW, allH);
  const ctx = tempCanvas.getContext('2d');

  if (useEasyBG) {
    ctx.drawImage(
      await createEasyBackground({
        width: maxW,
        height: allH,
      }),
      0,
      0,
    );
  } else if (useImageBG) {
    ctx.drawImage(
      await createImageBackground({
        image: backgroundImage,
        width: maxW,
        height: allH,
      }),
      0,
      0,
    );
  } else {
    ctx.drawImage(
      await createBackground({
        text,
        image: backgroundImage,
        width: maxW,
        height: allH,
      }),
      0,
      0,
    );
  }

  let allH2 = 0;
  if (startWithSpace) {
    allH2 += 50;
  }
  for (let i = 0; i < imageList.length; i++) {
    ctx.drawImage(imageList[i], 0, allH2);
    allH2 = allH2 + imageList[i].height;
    allH2 += 30;
  }

  return tempCanvas;
};

//输出为二进制流
/**
 * 在底层绘图工具层中输出最终缓冲区。
 *
 * @param options - BangDream列表；影响 outputFinalBuffer 的返回值。
 * @returns 异步处理结果。
 */
export const outputFinalBuffer = async function outputFinalBuffer({
  startWithSpace = true,
  imageList,
  useEasyBG = true,
  useImageBG,
  text,
  BGimage,
  compress,
}: OutputFinalOptions): Promise<Buffer> {
  const tempCanvas = await outputFinalCanv({
    startWithSpace,
    imageList,
    useEasyBG,
    useImageBG,
    text,
    BGimage,
  });
  let tempBuffer: Buffer;
  if (compress != undefined && compress) {
    tempBuffer = tempCanvas.toBufferSync('jpeg', { quality: 0.7 });
  } else {
    tempBuffer = tempCanvas.toBufferSync('png');
  }
  return tempBuffer;
};

/**
 * 创建 BangDream 插件对象或配置。
 * @param defaultOptions - BangDream列表；生成 BangDream对象。
 */
export const createOutputFinalImages =
  (defaultOptions: FinalImageRenderOptions = {}) =>
  async (
    imageList: OutputFinalOptions['imageList'],
    options: FinalImageRenderOptions = {},
  ): Promise<Array<Buffer | string>> => {
    const buffer = await outputFinalBuffer({
      imageList,
      ...defaultOptions,
      ...options,
    });
    return [buffer];
  };

export const outputEasyImages = createOutputFinalImages({ useEasyBG: true });
