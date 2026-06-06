import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/theme/render-theme';

export const BANGDREAM_TITLE_SPEC = {
  background: {
    x: 0,
    y: 0,
  },
  text: {
    first: {
      color: BANGDREAM_RENDER_THEME.color.surface,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 50,
      maxWidth: 900,
      textSize: 30,
      x: 74,
      y: 0,
    },
    second: {
      color: BANGDREAM_RENDER_THEME.color.labelBackground,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 68,
      maxWidth: 900,
      textSize: 40,
      x: 74,
      y: 42,
    },
  },
} as const;

export type BangDreamTitleTextSlot = keyof typeof BANGDREAM_TITLE_SPEC.text;

/**
 * 生成标题文字绘制参数。
 *
 * @param text - 标题文本。
 * @param slot - 标题第几行。
 */
export function createTitleTextDrawOptions(
  text: string,
  slot: BangDreamTitleTextSlot,
) {
  const spec = BANGDREAM_TITLE_SPEC.text[slot];

  return {
    color: spec.color,
    font: spec.font,
    lineHeight: spec.lineHeight,
    maxWidth: spec.maxWidth,
    text,
    textSize: spec.textSize,
  };
}

/**
 * 获取标题文字绘制位置。
 *
 * @param slot - 标题第几行。
 */
export function getTitleTextPosition(slot: BangDreamTitleTextSlot) {
  const spec = BANGDREAM_TITLE_SPEC.text[slot];

  return {
    x: spec.x,
    y: spec.y,
  };
}
