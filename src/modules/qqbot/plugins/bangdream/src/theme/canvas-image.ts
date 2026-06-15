import { Canvas, loadImage, Image } from 'skia-canvas';
import * as svg2img from 'svg2img';
import {
  bangDreamFallbackImageBuffer,
  readBangDreamAsset,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

const convertSvg = svg2img as unknown as (
  svg: string,
  callback: (error: Error | null, buffer: Buffer) => void,
) => void;

export const assetErrorImageBuffer = bangDreamFallbackImageBuffer;

/**
 * 在底层绘图工具层中加载图片FromPath。
 *
 * @param path - 本地文件路径。
 * @returns 异步处理结果。
 */
export async function loadImageFromPath(path: string): Promise<Image> {
  const buffer = await readBangDreamAsset(path);
  return await loadImage(buffer);
}

//指定字体，字号，文本，获取文本宽度
/**
 * 在底层绘图工具层中获取文本宽度。
 *
 * @param text - 待绘制文本。
 * @param textSize - 文本Size参数。
 * @param font - font参数。
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
 * 在底层绘图工具层中转换SvgToPNG缓冲区。
 *
 * @param svgBuffer - svg缓冲区参数。
 * @returns 异步处理结果。
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
