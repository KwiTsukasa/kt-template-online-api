import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

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
 * 生成标题文字绘制参数，并输出固定投影 `color`、`font`、`lineHeight`、`maxWidth`、`text` 字段。
 * @param text - 决定Title文本选项内容、边界或目标的 `text` 值。
 * @param slot - 决定Title文本选项内容、边界或目标的 `slot` 值。
 * @returns 包含 `color`、`font`、`lineHeight`、`maxWidth`、`text` 字段的Title文本选项。
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
 * 根据参数 `slot`，获取标题文字绘制位置。
 * @param slot - 决定根据参数 `slot`，获取标题文字绘制位置内容、边界或目标的 `slot` 值。
 * @returns 包含 `x`、`y` 字段的根据参数 `slot`，获取标题文字绘制位置。
 */
export function getTitleTextPosition(slot: BangDreamTitleTextSlot) {
  const spec = BANGDREAM_TITLE_SPEC.text[slot];

  return {
    x: spec.x,
    y: spec.y,
  };
}
