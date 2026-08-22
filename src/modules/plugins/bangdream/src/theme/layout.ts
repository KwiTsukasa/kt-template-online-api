import { BANGDREAM_RENDER_THEME } from '@/modules/plugins/bangdream/src/theme/render-theme';

interface SeparatorSpecOptions {
  width?: number;
  height?: number;
  startX?: number;
  endX?: number;
}

/**
 * 根据当前运行态构造Horizontal分隔线布局规格。
 * @returns 包含 `width`、`height`、`startX`、`startY`、`endX` 字段的Horizontal分隔线布局规格。
 */
export function createHorizontalSeparatorSpec({
  width = BANGDREAM_RENDER_THEME.layout.contentWidth,
  height = 30,
  startX = 5,
  endX = width - 5,
}: SeparatorSpecOptions = {}) {
  const y = height / 2;
  return {
    width,
    height,
    startX,
    startY: y,
    endX,
    endY: y,
    radius: 2,
    gap: 10,
    color: BANGDREAM_RENDER_THEME.color.separator,
  };
}

/**
 * 根据`height`、`options`构造垂直分隔线布局规格。
 * @param height - 决定垂直分隔线布局规格内容、边界或目标的 `height` 值。
 * @param options - 控制垂直分隔线布局规格筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
 * @returns 包含 `width`、`height`、`startX`、`startY`、`endX` 字段的垂直分隔线布局规格。
 */
export function createVerticalSeparatorSpec(
  height: number,
  options: Pick<SeparatorSpecOptions, 'startX' | 'endX'> = {},
) {
  const { startX = 10, endX = 15 } = options;
  return {
    width: 30,
    height,
    startX,
    startY: 0,
    endX,
    endY: height - 10,
    radius: 2,
    gap: 10,
    color: BANGDREAM_RENDER_THEME.color.separator,
  };
}
