import { Canvas, Image } from 'skia-canvas';
import {
  createBackground,
  createEasyBackground,
  createImageBackground,
} from '@/qqbot/plugins/bangDream/theme/canvas-background';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/theme/canvas-image';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/theme/asset-manifest';

let BGDefaultImage: Image;
/**
 * 在底层绘图工具层中加载图片Once。
 */
async function loadImageOnce() {
  BGDefaultImage = await loadImageFromPath(
    getBangDreamAssetPath('backgroundLive'),
  );
}
loadImageOnce();

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
 * 在底层绘图工具层中输出最终Canv。
 *
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export const outputFinalCanv = async function ({
  imageList,
  startWithSpace = true,
  useEasyBG = true,
  useImageBG = false,
  text = 'BanG Dream!',
  BGimage = BGDefaultImage,
}: OutputFinalOptions): Promise<Canvas> {
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
        image: BGimage,
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
        image: BGimage,
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
 * @param options1 - options1参数。
 * @returns 异步处理结果。
 */
export const outputFinalBuffer = async function ({
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
 * 在底层绘图工具层中创建输出最终图片列表。
 *
 * @param defaultOptions - defaultOptions参数，未传入时使用默认值。
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
