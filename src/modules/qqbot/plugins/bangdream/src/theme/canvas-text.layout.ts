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
 * 计算默认文本行高。
 *
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 */
export function getTextLineHeight(textSize: number) {
  return textSize * BANGDREAM_TEXT_SPEC.line.heightRatio;
}

/**
 * 计算文本和图片混排默认间距。
 *
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 */
export function getTextInlineSpacing(textSize: number) {
  return textSize * BANGDREAM_TEXT_SPEC.line.spacingRatio;
}

/**
 * 计算文本绘制 baseline。
 *
 * @param lineHeight - lineHeight 输入；限定 BangDream查询范围。
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 */
export function getTextBaselineY(lineHeight: number, textSize: number) {
  return (
    lineHeight * BANGDREAM_TEXT_SPEC.line.baselineLineRatio +
    textSize * BANGDREAM_TEXT_SPEC.line.baselineTextRatio
  );
}

/**
 * 计算内联图片按文本字号缩放后的宽度。
 *
 * @param image - image 输入；使用 `width`、`height` 字段生成结果。
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 */
export function getInlineImageWidth(image: ImageLike, textSize: number) {
  return (textSize * image.width) / image.height;
}

/**
 * 计算内联图片绘制 Y 坐标。
 *
 * @param baselineY - baselineY 输入；限定 BangDream查询范围。
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 */
export function getInlineImageY(baselineY: number, textSize: number) {
  return (
    baselineY -
    textSize * BANGDREAM_TEXT_SPEC.inlineImage.baselineTextOffsetRatio -
    textSize * BANGDREAM_TEXT_SPEC.inlineImage.baselineVerticalCenterRatio
  );
}

/**
 * 计算文本画布尺寸。
 *
 * @param options - BangDream列表；生成 BangDream对象。
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
