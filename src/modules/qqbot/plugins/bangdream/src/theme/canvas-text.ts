import {
  FontLibrary,
  Image,
  Canvas,
  CanvasRenderingContext2D,
} from 'skia-canvas';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';
import {
  BANGDREAM_TEXT_SPEC,
  BangDreamTextFont,
  BangDreamTextWithImageFont,
  createTextCanvasSize,
  getInlineImageWidth,
  getInlineImageY,
  getTextBaselineY,
  getTextInlineSpacing,
  getTextLineHeight,
} from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text.layout';

FontLibrary.use('old', [getBangDreamAssetPath('fontOld')]);
FontLibrary.use('FangZhengHeiTi', [
  getBangDreamAssetPath('fontFangZhengHeiTi'),
]);

interface WrapTextOptions {
  text: string;
  textSize?: number;
  maxWidth: number;
  lineHeight?: number;
  color?: string;
  font?: BangDreamTextFont;
}

//画文字,自动换行
/**
 * 在底层绘图工具层中绘制文本。
 *
 * @param options1 - options1 输入；影响 drawText 的返回值。
 * @returns 渲染或资源结果。
 */
export function drawText({
  text,
  textSize = BANGDREAM_TEXT_SPEC.font.defaultSize,
  maxWidth,
  lineHeight = getTextLineHeight(textSize),
  color = BANGDREAM_RENDER_THEME.color.primaryText,
  font = BANGDREAM_RENDER_THEME.font.body,
}: WrapTextOptions): Canvas {
  const wrappedTextData = wrapText({ text, maxWidth, lineHeight, textSize });
  let singleLineWidth: number | undefined;
  if (wrappedTextData.numberOfLines == 1) {
    const ctx = createMeasureContext();
    setFontStyle(ctx, textSize, font);
    singleLineWidth = ctx.measureText(wrappedTextData.wrappedText[0]).width;
  }
  const canvasSize = createTextCanvasSize({
    lineHeight,
    maxWidth,
    numberOfLines: wrappedTextData.numberOfLines,
    singleLineWidth,
  });
  const canvas = new Canvas(canvasSize.width, canvasSize.height);
  const ctx = canvas.getContext('2d');
  let y = getTextBaselineY(lineHeight, textSize);
  ctx.textBaseline = BANGDREAM_TEXT_SPEC.font.baseline;
  setFontStyle(ctx, textSize, font);
  ctx.fillStyle = color;
  const wrappedText = wrappedTextData.wrappedText;
  for (let i = 0; i < wrappedText.length; i++) {
    ctx.fillText(wrappedText[i], 0, y);
    y += lineHeight;
  }
  return canvas;
}

/**
 * 在底层绘图工具层中包装文本。
 *
 * @param options1 - options1 输入；影响 wrapText 的返回值。
 */
export function wrapText({
  text,
  textSize = BANGDREAM_TEXT_SPEC.font.defaultSize,
  maxWidth,
  font = 'old',
}: WrapTextOptions) {
  const ctx = createMeasureContext();
  const temp = text.split('\n');
  ctx.textBaseline = BANGDREAM_TEXT_SPEC.font.baseline;
  setFontStyle(ctx, textSize, font);

  for (let i = 0; i < temp.length; i++) {
    const temptext = temp[i];
    let a = 0;
    for (let n = 0; n < temptext.length; n++) {
      if (
        maxWidth > ctx.measureText(temptext.slice(0, temptext.length - n)).width
      ) {
        a = n;
        break;
      }
    }
    if (a != 0) {
      temp.splice(i + 1, 0, temp[i].slice(temp[i].length - a, temp[i].length));
      temp[i] = temp[i].slice(0, temp[i].length - a);
    }
  }

  for (let i = 0; i < temp.length; i++) {
    if (temp[i] == '') {
      temp.splice(i, 1);
      //去除空值
      i--;
    }
  }
  return {
    numberOfLines: temp.length,
    wrappedText: temp,
  };
}

interface TextWithImagesOptions {
  textSize?: number;
  maxWidth: number;
  lineHeight?: number;
  content: (string | Canvas | Image)[];
  spacing?: number;
  color?: string;
  font?: BangDreamTextWithImageFont;
}

// 画文字包含图片
/**
 * 在底层绘图工具层中绘制文本With图片列表。
 *
 * @param options1 - options1 输入；影响 drawTextWithImages 的返回值。
 */
export function drawTextWithImages({
  textSize = BANGDREAM_TEXT_SPEC.font.defaultSize,
  maxWidth,
  lineHeight = getTextLineHeight(textSize),
  content,
  spacing = getTextInlineSpacing(textSize),
  color = BANGDREAM_RENDER_THEME.color.primaryText,
  font = BANGDREAM_RENDER_THEME.font.body,
}: TextWithImagesOptions) {
  const wrappedTextData = wrapTextWithImages({
    textSize,
    maxWidth,
    lineHeight,
    content,
    spacing,
  });
  const wrappedText = wrappedTextData.wrappedText;
  let singleLineWidth: number | undefined;
  if (wrappedTextData.numberOfLines == 1) {
    const ctx = createMeasureContext();
    setFontStyle(ctx, textSize, font);
    let width = 0;
    for (let n = 0; n < wrappedText[0].length; n++) {
      if (typeof wrappedText[0][n] === 'string') {
        width += ctx.measureText(wrappedText[0][n] as string).width;
      } else {
        //等比例缩放图片，至高度与textSize相同
        const tempImage = wrappedText[0][n] as Canvas | Image;
        width += getInlineImageWidth(tempImage, textSize);
      }
      width += spacing;
    }
    singleLineWidth = width - spacing;
  }
  const canvasSize = createTextCanvasSize({
    lineHeight,
    maxWidth,
    numberOfLines: wrappedTextData.numberOfLines,
    singleLineWidth,
  });
  const canvas = new Canvas(canvasSize.width, canvasSize.height);
  const ctx = canvas.getContext('2d');
  let y = getTextBaselineY(lineHeight, textSize);
  ctx.textBaseline = BANGDREAM_TEXT_SPEC.font.baseline;
  setFontStyle(ctx, textSize, font);
  ctx.fillStyle = color;
  for (let i = 0; i < wrappedText.length; i++) {
    let tempX = 0;
    for (let n = 0; n < wrappedText[i].length; n++) {
      if (typeof wrappedText[i][n] === 'string') {
        ctx.fillText(wrappedText[i][n] as string, tempX, y);
        tempX += ctx.measureText(wrappedText[i][n] as string).width;
      } else {
        //等比例缩放图片，至高度与textSize相同
        const tempImage = wrappedText[i][n] as Canvas | Image;
        const tempWidth = getInlineImageWidth(tempImage, textSize);
        ctx.drawImage(
          tempImage,
          tempX,
          getInlineImageY(y, textSize),
          tempWidth,
          textSize,
        );
        tempX += tempWidth;
      }
      if (tempX != 0) {
        tempX += spacing;
      }
    }
    y += lineHeight;
  }
  return canvas;
}

// 画文字包含图片 的计算换行
/**
 * 在底层绘图工具层中包装文本With图片列表。
 *
 * @param options1 - options1 输入；影响 wrapTextWithImages 的返回值。
 */
function wrapTextWithImages({
  textSize = BANGDREAM_TEXT_SPEC.font.defaultSize,
  maxWidth,
  content,
  spacing = getTextInlineSpacing(textSize),
  font = 'old',
}: TextWithImagesOptions) {
  const ctx = createMeasureContext();
  ctx.textBaseline = BANGDREAM_TEXT_SPEC.font.baseline;
  setFontStyle(ctx, textSize, font);
  const temp: Array<Array<string | Image | Canvas>> = [[]];
  let lineNumber = 0;
  let tempX = 0;

  /**
   * 在底层绘图工具层中处理new线条。
   */
  function newLine() {
    lineNumber++;
    tempX = 0;
    temp.push([]);
  }

  for (let i = 0; i < content.length; i++) {
    if (content[i] == undefined || content[i] == null) {
      content[i] = '?';
    }
    if (typeof content[i] === 'string') {
      let temptext = content[i] as string;
      while (temptext.length > 0) {
        const lineBreakIndex = temptext.indexOf('\n');
        if (lineBreakIndex !== -1) {
          const substring = temptext.slice(0, lineBreakIndex);
          temp[lineNumber].push(substring);
          newLine();
          temptext = temptext.slice(lineBreakIndex + 1);
          continue;
        }

        const remainingWidth = maxWidth - tempX;
        const measuredWidth = ctx.measureText(temptext).width;
        if (remainingWidth >= measuredWidth) {
          temp[lineNumber].push(temptext);
          tempX += measuredWidth;
          break;
        } else {
          let splitIndex = 0;
          for (let j = temptext.length - 1; j >= 0; j--) {
            const substr = temptext.slice(0, j);
            const substrWidth = ctx.measureText(substr).width;
            if (substrWidth <= remainingWidth) {
              splitIndex = j;
              break;
            }
          }
          const substring = temptext.slice(0, splitIndex);
          temp[lineNumber].push(substring);
          newLine();
          temptext = temptext.slice(splitIndex);
        }
      }
    } else if (content[i] instanceof Canvas || content[i] instanceof Image) {
      const tempImage = content[i] as Image;
      const tempWidth = getInlineImageWidth(tempImage, textSize);
      if (tempX + tempWidth > maxWidth) {
        newLine();
      }
      temp[lineNumber].push(tempImage);
      tempX += tempWidth;
    }
    tempX += spacing;
  }

  if (temp[temp.length - 1].length === 0) {
    temp.pop();
  }

  return {
    numberOfLines: temp.length,
    wrappedText: temp,
  };
}

/**
 * 设置Font Style。
 * @param ctx - ctx 输入；使用 `font` 字段生成结果。
 * @param textSize - textSize 输入；写入 BangDream状态。
 * @param font - font 输入；使用 `fallback` 字段生成结果。
 */
export const setFontStyle = function (
  ctx: CanvasRenderingContext2D,
  textSize: number,
  font: string,
) {
  //设置字体大小
  ctx.font = `${textSize}px ${font},${BANGDREAM_RENDER_THEME.font.fallback}`;
};

/**
 * 创建文本测量上下文。
 */
function createMeasureContext() {
  const canvas = new Canvas(
    BANGDREAM_TEXT_SPEC.canvas.measureWidth,
    BANGDREAM_TEXT_SPEC.canvas.measureHeight,
  );
  return canvas.getContext('2d');
}
