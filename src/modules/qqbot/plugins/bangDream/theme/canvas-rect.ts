import { Canvas, FontLibrary } from 'skia-canvas';
import { getTextWidth } from '@/modules/qqbot/plugins/bangDream/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangDream/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangDream/theme/render-theme';

FontLibrary.use('old', [getBangDreamAssetPath('fontOld')]);

interface RoundedRect {
  width: number;
  height: number;
  radius?: number | [number, number, number, number];
  color?: string;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

// 画圆角矩形
/**
 * 在底层绘图工具层中绘制RoundedRect。
 *
 * @param options1 - options1参数。
 * @returns 渲染或资源结果。
 */
export function drawRoundedRect({
  width,
  height,
  radius = 25,
  color = BANGDREAM_RENDER_THEME.color.surface,
  opacity = 0.9,
  strokeColor = '#bbbbbb',
  strokeWidth = 0,
}: RoundedRect): Canvas {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  if (typeof radius === 'number') {
    radius = [radius, radius, radius, radius];
  }

  ctx.beginPath();
  ctx.moveTo(radius[0], 0);
  ctx.lineTo(width - radius[1], 0);
  ctx.quadraticCurveTo(width, 0, width, radius[1]);
  ctx.lineTo(width, height - radius[2]);
  ctx.quadraticCurveTo(width, height, width - radius[2], height);
  ctx.lineTo(radius[3], height);
  ctx.quadraticCurveTo(0, height, 0, height - radius[3]);
  ctx.lineTo(0, radius[0]);
  ctx.quadraticCurveTo(0, 0, radius[0], 0);
  ctx.closePath();

  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fill();

  if (strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;

    ctx.beginPath();
    ctx.moveTo(radius[0], strokeWidth / 2);
    ctx.lineTo(width - radius[1], strokeWidth / 2);
    ctx.quadraticCurveTo(
      width - strokeWidth / 2,
      strokeWidth / 2,
      width - strokeWidth / 2,
      radius[1],
    );
    ctx.lineTo(width - strokeWidth / 2, height - radius[2]);
    ctx.quadraticCurveTo(
      width - strokeWidth / 2,
      height - strokeWidth / 2,
      width - radius[2],
      height - strokeWidth / 2,
    );
    ctx.lineTo(radius[3], height - strokeWidth / 2);
    ctx.quadraticCurveTo(
      strokeWidth / 2,
      height - strokeWidth / 2,
      strokeWidth / 2,
      height - radius[3],
    );
    ctx.lineTo(strokeWidth / 2, radius[0]);
    ctx.quadraticCurveTo(
      strokeWidth / 2,
      strokeWidth / 2,
      radius[0],
      strokeWidth / 2,
    );
    ctx.closePath();

    ctx.stroke();
  }

  return canvas;
}

type textAlign = 'left' | 'right' | 'center' | 'start' | 'end';
interface RoundedRectWithText {
  width?: number;
  height?: number;
  radius?: number;
  color?: string;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  font?: string;
  text: string;
  textColor?: string;
  textSize: number;
  textAlign?: textAlign;
}

//画圆角矩形并填充文字
/**
 * 在底层绘图工具层中绘制RoundedRectWith文本。
 *
 * @param options1 - options1参数。
 * @returns 渲染或资源结果。
 */
export function drawRoundedRectWithText({
  text,
  font = BANGDREAM_RENDER_THEME.font.body,
  textColor = BANGDREAM_RENDER_THEME.color.surface,
  textSize,
  textAlign = 'center',
  height = (textSize * 4) / 3,
  width = getTextWidth(text, textSize, font) + height,
  radius = height / 2,
  color = BANGDREAM_RENDER_THEME.color.labelBackground,
  opacity = 1,
  strokeColor = color,
  strokeWidth = 0,
}: RoundedRectWithText): Canvas {
  const canvas = drawRoundedRect({
    width,
    height,
    radius,
    color,
    opacity,
    strokeColor,
    strokeWidth,
  });
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = textColor;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${textSize}px ${font},${BANGDREAM_RENDER_THEME.font.fallback}`;

  let x = 0,
    y = 0;
  if (textAlign === 'left' || textAlign === 'start') {
    x = radius;
  } else if (textAlign === 'right' || textAlign === 'end') {
    x = width - radius;
  } else if (textAlign === 'center') {
    x = width / 2;
  }

  y = height / 2 + textSize / 3;

  ctx.textAlign = textAlign;
  ctx.fillText(text, x, y);

  return canvas;
}
