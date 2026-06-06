import {
  FontLibrary,
  Image,
  Canvas,
  CanvasRenderingContext2D,
} from 'skia-canvas';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
FontLibrary.use('old', [`${assetsRootPath}/Fonts/old.ttf`]);
FontLibrary.use('FangZhengHeiTi', [
  `${assetsRootPath}/Fonts/FangZhengHeiTi_GBK.ttf`,
]);

interface WrapTextOptions {
  text: string;
  textSize?: number;
  maxWidth: number;
  lineHeight?: number;
  color?: string;
  font?: 'FangZhengHeiTi' | 'old' | 'default';
}

//画文字,自动换行
/**
 * 在底层绘图工具层中绘制文本。
 *
 * @param options1 - options1参数。
 * @returns 渲染或资源结果。
 */
export function drawText({
  text,
  textSize = 40,
  maxWidth,
  lineHeight = (textSize * 4) / 3,
  color = '#505050',
  font = 'old',
}: WrapTextOptions): Canvas {
  const wrappedTextData = wrapText({ text, maxWidth, lineHeight, textSize });
  let canvas: Canvas;
  if (wrappedTextData.numberOfLines == 0) {
    canvas = new Canvas(1, lineHeight);
  } else if (wrappedTextData.numberOfLines == 1) {
    canvas = new Canvas(1, 1);
    const ctx = canvas.getContext('2d');
    setFontStyle(ctx, textSize, font);
    const width = (maxWidth = ctx.measureText(
      wrappedTextData.wrappedText[0],
    ).width);
    canvas = new Canvas(width, lineHeight);
  } else {
    canvas = new Canvas(maxWidth, lineHeight * wrappedTextData.numberOfLines);
  }
  const ctx = canvas.getContext('2d');
  let y = lineHeight / 2 + textSize / 3;
  ctx.textBaseline = 'alphabetic';
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
 * @param options1 - options1参数。
 */
export function wrapText({
  text,
  textSize,
  maxWidth,
  font = 'old',
}: WrapTextOptions) {
  const canvas = new Canvas(1, 1);
  const ctx = canvas.getContext('2d');
  const temp = text.split('\n');
  ctx.textBaseline = 'alphabetic';
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
  font?: 'default' | 'old';
}

// 画文字包含图片
/**
 * 在底层绘图工具层中绘制文本With图片列表。
 *
 * @param options1 - options1参数。
 */
export function drawTextWithImages({
  textSize = 40,
  maxWidth,
  lineHeight = (textSize * 4) / 3,
  content,
  spacing = textSize / 3,
  color = '#505050',
  font = 'old',
}: TextWithImagesOptions) {
  const wrappedTextData = wrapTextWithImages({
    textSize,
    maxWidth,
    lineHeight,
    content,
    spacing,
  });
  const wrappedText = wrappedTextData.wrappedText;
  let canvas: Canvas;
  if (wrappedTextData.numberOfLines == 0) {
    canvas = new Canvas(1, lineHeight);
  }
  //单行文字，宽度为第一行的宽度
  else if (wrappedTextData.numberOfLines == 1) {
    canvas = new Canvas(1, 1);
    const ctx = canvas.getContext('2d');
    setFontStyle(ctx, textSize, font);
    let Width = 0;
    for (let n = 0; n < wrappedText[0].length; n++) {
      if (typeof wrappedText[0][n] === 'string') {
        Width += ctx.measureText(wrappedText[0][n] as string).width;
      } else {
        //等比例缩放图片，至高度与textSize相同
        const tempImage = wrappedText[0][n] as Canvas | Image;
        const tempWidth = (textSize * tempImage.width) / tempImage.height; //等比例缩放到高度与字体大小相同后，图片宽度
        Width += tempWidth;
      }
      Width += spacing;
    }
    canvas = new Canvas(Width - spacing, lineHeight);
  }
  //多行文字
  else {
    canvas = new Canvas(maxWidth, lineHeight * wrappedTextData.numberOfLines);
  }
  const ctx = canvas.getContext('2d');
  let y = lineHeight / 2 + textSize / 3;
  ctx.textBaseline = 'alphabetic';
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
        const tempWidth = (textSize * tempImage.width) / tempImage.height; //等比例缩放到高度与字体大小相同后，图片宽度
        ctx.drawImage(
          tempImage,
          tempX,
          y - textSize / 3 - textSize / 2,
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
 * @param options1 - options1参数。
 */
function wrapTextWithImages({
  textSize = 40,
  maxWidth,
  content,
  spacing = textSize / 3,
  font = 'old',
}: TextWithImagesOptions) {
  const canvas = new Canvas(1, 1);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
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
      const tempWidth = tempImage.width * (textSize / tempImage.height);
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
 * 在底层绘图工具层中设置FontStyle。
 *
 * @param ctx - 画布绘图上下文。
 * @param textSize - 文本Size参数。
 * @param font - font参数。
 */
export const setFontStyle = function (
  ctx: CanvasRenderingContext2D,
  textSize: number,
  font: string,
) {
  //设置字体大小
  ctx.font = textSize + 'px ' + font + ',Microsoft Yahei';
};
