import { Canvas, loadImage, Image } from 'skia-canvas';
import * as svg2img from 'svg2img';
import {
  bangdreamFallbackImageBuffer,
  readBangDreamAsset,
} from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

const convertSvg = svg2img as unknown as (
  svg: string,
  callback: (error: Error | null, buffer: Buffer) => void,
) => void;

export const assetErrorImageBuffer = bangdreamFallbackImageBuffer;

/**
 * 按`path`读取图片路径；从受控资源来源加载所需数据（`loadImage`）。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 图片路径。
 */
export async function loadImageFromPath(path: string): Promise<Image> {
  const buffer = await readBangDreamAsset(path);
  return await loadImage(buffer);
}

//指定字体，字号，文本，获取文本宽度
/**
 * 按`text`、`textSize`、`font`读取文本Width；从 `canvas.getContext` 读取文本Width。
 * @param text - 决定文本Width内容、边界或目标的 `text` 值。
 * @param textSize - 限制文本Width数量、尺寸、等级或重试边界的数值。
 * @param font - 决定文本Width内容、边界或目标的 `font` 值。
 * @returns 文本Width。
 * @throws 当 `!context` 成立时拒绝当前输入并抛出 `Error`。
 */
export function getTextWidth(text: string, textSize: number, font: string) {
  const canvas = new Canvas(1, 1);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Cannot create canvas context');
  }

  context.font = `${textSize}px ${font}`;
  const metrics = context.measureText(text);

  return metrics.width;
}

/**
 * 将 SVG Buffer 解码后异步转换为 PNG Buffer，并把转换器错误包装为明确失败。
 * @param svgBuffer - 用于SvgPng缓冲区的领域对象，包含 `toString` 字段。
 * @returns 完成初始化并携带当前边界配置的SvgPng缓冲区。
 */
export function convertSvgToPngBuffer(svgBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 将 SVG buffer 转换为字符串
    const svgString = svgBuffer.toString('utf-8');

    // 使用 svg2img 将 SVG 字符串转换为 PNG buffer
    convertSvg(
      svgString,

      (error, buffer) => {
        if (error) {
          return reject(
            new Error(`Failed to convert SVG to PNG: ${error.message}`),
          );
        }
        resolve(buffer);
      },
    );
  });
}
