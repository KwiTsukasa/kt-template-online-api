import { Canvas, Image } from 'skia-canvas';

/**
 * 在图片布局层中处理stack图片。
 *
 * @param list - 待处理列表。
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
 * 在图片布局层中处理stack图片Horizontal。
 *
 * @param list - 待处理列表。
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
 * 在图片布局层中调整图片。
 *
 * @param options1 - options1参数。
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
