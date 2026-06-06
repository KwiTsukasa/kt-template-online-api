import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

interface SeparatorSpecOptions {
  width?: number;
  height?: number;
  startX?: number;
  endX?: number;
}

/**
 * 创建横向虚线分割规格。
 *
 * @param options - 分割线宽高和横向端点。
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
 * 创建纵向虚线分割规格。
 *
 * @param height - 分割线高度。
 * @param options - 纵向端点配置。
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
