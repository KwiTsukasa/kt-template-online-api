import { Canvas, Image } from 'skia-canvas';

/**
 * 根据`list`处理stack图片；把图片、文本或图形按布局规格绘制到画布。
 * @param list - 用于stack图片的领域对象，包含 `length`、`i` 字段。
 * @returns stack图片。
 */
export function stackImage(list: Array<Image | Canvas>) {
  let maxW = 0;
  let allH = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].width > maxW) {
      maxW = list[i].width;
    }
    allH += list[i].height;
  }
  const tempCanvas = new Canvas(maxW, allH);
  const ctx = tempCanvas.getContext('2d');
  let allH2 = 0;
  for (let i = 0; i < list.length; i++) {
    ctx.drawImage(list[i], 0, allH2);
    allH2 = allH2 + list[i].height;
  }
  return tempCanvas;
}

/**
 * 根据`list`处理stack图片Horizontal；把图片、文本或图形按布局规格绘制到画布。
 * @param list - 用于stack图片Horizontal的领域对象，包含 `length`、`i` 字段。
 * @returns stack图片Horizontal。
 */
export function stackImageHorizontal(list: Array<Image | Canvas>) {
  let maxH = 0;
  let allW = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].height > maxH) {
      maxH = list[i].height;
    }
    allW += list[i].width;
  }
  const tempCanvas = new Canvas(allW, maxH);
  const ctx = tempCanvas.getContext('2d');
  let allW2 = 0;
  for (let i = 0; i < list.length; i++) {
    ctx.drawImage(list[i], allW2, 0);
    allW2 = allW2 + list[i].width;
  }
  return tempCanvas;
}

interface ResizeImageOptions {
  image: Image | Canvas;
  heightMax?: number;
  widthMax?: number;
}
//输入canvas或Image，高度，宽度，返回等比例缩放到限制高度的canvas
/**
 * 根据当前运行态处理resize图片；把图片、文本或图形按布局规格绘制到画布。
 * @returns resize图片。
 */
export function resizeImage({
  image,
  heightMax,
  widthMax,
}: ResizeImageOptions) {
  let height = image.height;
  let width = image.width;
  if (heightMax != undefined) {
    width = (width * heightMax) / height;
    height = heightMax;
  }
  if (widthMax != undefined) {
    height = (height * widthMax) / width;
    width = widthMax;
  }
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}
