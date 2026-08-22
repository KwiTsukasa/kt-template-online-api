interface ImageLike {
  height: number;
  width: number;
}

interface TextCanvasSizeOptions {
  lineHeight: number;
  maxWidth: number;
  numberOfLines: number;
  singleLineWidth?: number;
}

export const BANGDREAM_TEXT_SPEC = {
  canvas: {
    emptyWidth: 1,
    measureHeight: 1,
    measureWidth: 1,
  },
  font: {
    baseline: 'alphabetic',
    defaultSize: 40,
  },
  inlineImage: {
    baselineTextOffsetRatio: 1 / 3,
    baselineVerticalCenterRatio: 1 / 2,
  },
  line: {
    baselineLineRatio: 1 / 2,
    baselineTextRatio: 1 / 3,
    heightRatio: 4 / 3,
    spacingRatio: 1 / 3,
  },
} as const;

export type BangDreamTextFont = 'FangZhengHeiTi' | 'old' | 'default';

export type BangDreamTextWithImageFont = 'default' | 'old';

/**
 * 按`textSize`读取默认文本行高。
 * @param textSize - 限制默认文本行高数量、尺寸、等级或重试边界的数值。
 * @returns 默认文本行高。
 */
export function getTextLineHeight(textSize: number) {
  return textSize * BANGDREAM_TEXT_SPEC.line.heightRatio;
}

/**
 * 按`textSize`读取文本和图片混排默认间距。
 * @param textSize - 限制文本和图片混排默认间距数量、尺寸、等级或重试边界的数值。
 * @returns 文本和图片混排默认间距。
 */
export function getTextInlineSpacing(textSize: number) {
  return textSize * BANGDREAM_TEXT_SPEC.line.spacingRatio;
}

/**
 * 按行高与字号的主题比例计算文本基线纵坐标，使文本在统一行框中垂直对齐。
 * @param lineHeight - 决定文本绘制 baseline内容、边界或目标的 `lineHeight` 值。
 * @param textSize - 限制文本绘制 baseline数量、尺寸、等级或重试边界的数值。
 * @returns 文本绘制 baseline。
 */
export function getTextBaselineY(lineHeight: number, textSize: number) {
  return (
    lineHeight * BANGDREAM_TEXT_SPEC.line.baselineLineRatio +
    textSize * BANGDREAM_TEXT_SPEC.line.baselineTextRatio
  );
}

/**
 * 按`image`、`textSize`读取内联图片按文本字号缩放后的宽度。
 * @param image - 用于内联图片按文本字号缩放后的宽度的领域对象，包含 `width`、`height` 字段。
 * @param textSize - 限制内联图片按文本字号缩放后的宽度数量、尺寸、等级或重试边界的数值。
 * @returns 内联图片按文本字号缩放后的宽度。
 */
export function getInlineImageWidth(image: ImageLike, textSize: number) {
  return (textSize * image.width) / image.height;
}

/**
 * 按`baselineY`、`textSize`读取内联图片绘制 Y 坐标。
 * @param baselineY - 决定内联图片绘制 Y 坐标内容、边界或目标的 `baselineY` 值。
 * @param textSize - 限制内联图片绘制 Y 坐标数量、尺寸、等级或重试边界的数值。
 * @returns 内联图片绘制 Y 坐标。
 */
export function getInlineImageY(baselineY: number, textSize: number) {
  return (
    baselineY -
    textSize * BANGDREAM_TEXT_SPEC.inlineImage.baselineTextOffsetRatio -
    textSize * BANGDREAM_TEXT_SPEC.inlineImage.baselineVerticalCenterRatio
  );
}

/**
 * 计算文本画布尺寸，并输出固定投影 `height`、`width` 字段。
 * @returns 包含 `height`、`width` 字段的文本CanvasSize。
 */
export function createTextCanvasSize({
  lineHeight,
  maxWidth,
  numberOfLines,
  singleLineWidth = BANGDREAM_TEXT_SPEC.canvas.emptyWidth,
}: TextCanvasSizeOptions) {
  if (numberOfLines === 0) {
    return {
      height: lineHeight,
      width: BANGDREAM_TEXT_SPEC.canvas.emptyWidth,
    };
  }
  if (numberOfLines === 1) {
    return {
      height: lineHeight,
      width: singleLineWidth,
    };
  }
  return {
    height: lineHeight * numberOfLines,
    width: maxWidth,
  };
}
