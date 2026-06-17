import { Canvas, Image } from 'skia-canvas';
import { drawRoundedRect } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-rect';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { resizeImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import {
  BANGDREAM_DATA_BLOCK_SPEC,
  calculateHorizontalDataBlockSize,
  calculateVerticalDataBlockSize,
  getDataBlockTitleLineHeight,
} from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.layout';

interface DataBlockOptions {
  list: Array<Canvas | Image>;
  BG?: boolean;
  topLeftText?: string;
  opacity?: number;
}
//组合表格子程序，使用block当做底，通过最大高度换行，默认高度无上限
/**
 * 在图片布局层中绘制数据块。
 *
 * @param options1 - options1 输入；影响 drawDataBlock 的返回值。
 * @returns 渲染或资源结果。
 */
export function drawDataBlock({
  list,
  BG = true,
  topLeftText,
  opacity = BANGDREAM_DATA_BLOCK_SPEC.background.defaultOpacity,
}: DataBlockOptions): Canvas {
  //计算高度
  let contentHeight = 0;
  let maxW = 0;
  for (let i = 0; i < list.length; i++) {
    contentHeight += list[i].height;
    if (list[i].width > maxW) {
      maxW = list[i].width;
    }
  }
  const allH =
    contentHeight +
    (BG ? BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight : 0);
  const canvasSize = calculateVerticalDataBlockSize({
    contentHeight,
    maxContentWidth: maxW,
    withBackground: BG,
    withTitle: topLeftText != undefined,
  });

  // 创建 Canvas
  const tempCanvas = new Canvas(canvasSize.width, canvasSize.height);
  const ctx = tempCanvas.getContext('2d');

  //画背景
  if (BG) {
    if (topLeftText != undefined) {
      //右上角文字
      ctx.drawImage(
        drawRoundedRect({
          //画字底，左下角右下角没有圆角
          opacity: 1,
          color: BANGDREAM_DATA_BLOCK_SPEC.title.backgroundColor,
          width: BANGDREAM_DATA_BLOCK_SPEC.title.blockSize,
          height:
            BANGDREAM_DATA_BLOCK_SPEC.title.height +
            BANGDREAM_DATA_BLOCK_SPEC.title.rectExtraSize,
          radius: [
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            0,
            0,
          ],
          strokeColor: BANGDREAM_DATA_BLOCK_SPEC.title.strokeColor,
          strokeWidth: BANGDREAM_DATA_BLOCK_SPEC.title.strokeWidth,
        }),
        BANGDREAM_DATA_BLOCK_SPEC.vertical.titleRectX,
        BANGDREAM_DATA_BLOCK_SPEC.vertical.titleRectY,
      );

      const textImage = drawText({
        //画字
        color: BANGDREAM_DATA_BLOCK_SPEC.title.textColor,
        text: topLeftText,
        maxWidth:
          BANGDREAM_DATA_BLOCK_SPEC.title.blockSize -
          BANGDREAM_DATA_BLOCK_SPEC.title.textInset * 2,
        lineHeight: getDataBlockTitleLineHeight(),
      });
      ctx.drawImage(
        textImage,
        BANGDREAM_DATA_BLOCK_SPEC.vertical.titleCenterX - textImage.width / 2,
        BANGDREAM_DATA_BLOCK_SPEC.vertical.titleTextY,
      );
      ctx.drawImage(
        drawRoundedRect({
          //画总底，左上角没有圆角
          opacity,
          width: maxW + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraWidth,
          height: allH,
          radius: [
            0,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
          ],
        }),
        BANGDREAM_DATA_BLOCK_SPEC.vertical.backgroundOffsetX,
        BANGDREAM_DATA_BLOCK_SPEC.title.height,
      );
    } else {
      ctx.drawImage(
        drawRoundedRect({
          //画总底
          opacity,
          width: maxW + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraWidth,
          height: allH,
        }),
        BANGDREAM_DATA_BLOCK_SPEC.vertical.backgroundOffsetX,
        BANGDREAM_DATA_BLOCK_SPEC.vertical.backgroundOffsetY,
      );
    }
  }
  let allH2 = 0;
  if (BG) {
    allH2 += BANGDREAM_DATA_BLOCK_SPEC.vertical.contentOffsetY;
    if (topLeftText != undefined) {
      allH2 += BANGDREAM_DATA_BLOCK_SPEC.title.height;
    }
  }

  const xStart = BG ? BANGDREAM_DATA_BLOCK_SPEC.vertical.contentOffsetX : 0;

  for (let i = 0; i < list.length; i++) {
    ctx.drawImage(list[i], xStart, allH2);
    allH2 = allH2 + list[i].height;
  }

  return tempCanvas;
}

/**
 * 在图片布局层中绘制数据块Horizontal。
 *
 * @param options1 - options1 输入；影响 drawDataBlockHorizontal 的返回值。
 * @returns 渲染或资源结果。
 */
export function drawDataBlockHorizontal({
  list,
  BG = true,
  topLeftText,
}: DataBlockOptions): Canvas {
  // 计算宽度和高度
  let contentWidth = 0;
  let maxH = 0;
  for (let i = 0; i < list.length; i++) {
    contentWidth += list[i].width;
    if (list[i].height > maxH) {
      maxH = list[i].height;
    }
  }
  const allW =
    contentWidth +
    (BG ? BANGDREAM_DATA_BLOCK_SPEC.background.outerExtraWidth : 0);
  const canvasSize = calculateHorizontalDataBlockSize({
    contentWidth,
    maxContentHeight: maxH,
    withBackground: BG,
    withTitle: topLeftText !== undefined,
  });

  // 创建 Canvas
  const tempCanvas = new Canvas(canvasSize.width, canvasSize.height);
  const ctx = tempCanvas.getContext('2d');

  // 绘制背景
  if (BG) {
    if (topLeftText !== undefined) {
      // 右上角文字
      ctx.drawImage(
        drawRoundedRect({
          opacity: 1,
          color: BANGDREAM_DATA_BLOCK_SPEC.title.backgroundColor,
          width:
            BANGDREAM_DATA_BLOCK_SPEC.title.height +
            BANGDREAM_DATA_BLOCK_SPEC.title.rectExtraSize,
          height: BANGDREAM_DATA_BLOCK_SPEC.title.blockSize,
          radius: [
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            0,
            0,
          ],
          strokeColor: BANGDREAM_DATA_BLOCK_SPEC.title.strokeColor,
          strokeWidth: BANGDREAM_DATA_BLOCK_SPEC.title.strokeWidth,
        }),
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.titleRectX,
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.titleRectY,
      );

      const textImage = drawText({
        color: BANGDREAM_DATA_BLOCK_SPEC.title.textColor,
        text: topLeftText,
        maxWidth: getDataBlockTitleLineHeight(),
        lineHeight:
          BANGDREAM_DATA_BLOCK_SPEC.title.blockSize -
          BANGDREAM_DATA_BLOCK_SPEC.title.textInset * 2,
      });
      ctx.save();
      ctx.translate(
        getDataBlockTitleLineHeight(),
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.titleCenterY,
      );
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(textImage, 0, 0);
      ctx.restore();

      ctx.drawImage(
        drawRoundedRect({
          width: allW - BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraWidth,
          height: maxH + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight,
          radius: [
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            0,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
            BANGDREAM_DATA_BLOCK_SPEC.background.radius,
          ],
        }),
        BANGDREAM_DATA_BLOCK_SPEC.title.height,
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.contentOffsetY,
      );
    } else {
      ctx.drawImage(
        drawRoundedRect({
          width: allW - BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraWidth,
          height: maxH + BANGDREAM_DATA_BLOCK_SPEC.background.fillExtraHeight,
        }),
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.backgroundOffsetX,
        BANGDREAM_DATA_BLOCK_SPEC.horizontal.backgroundOffsetY,
      );
    }
  }

  let allW2 = 0;
  if (BG) {
    allW2 += BANGDREAM_DATA_BLOCK_SPEC.horizontal.contentOffsetX;
    if (topLeftText !== undefined) {
      allW2 += BANGDREAM_DATA_BLOCK_SPEC.title.height;
    }
  }
  for (let i = 0; i < list.length; i++) {
    ctx.drawImage(
      list[i],
      allW2,
      BANGDREAM_DATA_BLOCK_SPEC.horizontal.contentOffsetY,
    );
    allW2 += list[i].width;
  }

  return tempCanvas;
}

/**
 * 在图片布局层中绘制横幅图片画布。
 *
 * @param eventBannerImage - eventBannerImage 输入；影响 drawBannerImageCanvas 的返回值。
 * @returns 渲染或资源结果。
 */
export function drawBannerImageCanvas(eventBannerImage: Image): Canvas {
  return resizeImage({
    image: eventBannerImage,
    widthMax: BANGDREAM_DATA_BLOCK_SPEC.banner.widthMax,
  });
}
