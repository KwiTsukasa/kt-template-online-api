import { Canvas, loadImage, Image } from 'skia-canvas';
import * as svg2img from 'svg2img';
import {
  bangdreamFallbackImageBuffer,
  readBangDreamAsset,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

const convertSvg = svg2img as unknown as (
  svg: string,
  callback: (error: Error | null, buffer: Buffer) => void,
) => void;

export const assetErrorImageBuffer = bangdreamFallbackImageBuffer;

/**
 * 在底层绘图工具层中加载图片FromPath。
 *
 * @param path - 路由或文件路径；驱动 `readBangDreamAsset()` 的 BangDream步骤。
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
 * @param text - 待匹配文本；驱动 `context.measureText()` 的 BangDream步骤。
 * @param textSize - textSize 输入；限定 BangDream查询范围。
 * @param font - font 输入；限定 BangDream查询范围。
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
 * 执行 BangDream 插件流程。
 *
 * @param svgBuffer - svgBuffer 输入；生成规范化文本。
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
