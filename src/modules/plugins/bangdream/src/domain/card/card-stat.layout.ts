export interface StatLineTextParams {
  label: string;
  limitBreakValue?: number;
  value: number;
}

export const BANGDREAM_STAT_LIST_SPEC = {
  line: {
    bar: {
      height: 30,
      radius: 15,
      strokeWidth: 0,
      widthScale: 2,
      x: 20,
      y: 35,
    },
    canvas: {
      height: 70,
      width: 800,
    },
    text: {
      lineHeight: 30,
      maxWidth: 800,
      textSize: 30,
      x: 20,
      y: 0,
    },
  },
  spacer: {
    height: 5,
    width: 1,
  },
} as const;

/**
 * 根据`params`构造综合力数值行展示文本；当 `params.limitBreakValue == null` 成立时返回 `baseText`。
 * @param params - 用于综合力数值行展示文本的领域对象，包含 `label`、`value`、`limitBreakValue` 字段。
 * @returns 按参数编码并拼接完成的综合力数值行展示文本。
 */
export function createStatLineText(params: StatLineTextParams): string {
  const baseText = `${params.label}: ${Math.floor(params.value)}`;

  if (params.limitBreakValue == null) {
    return baseText;
  }

  return `${baseText} + (${params.limitBreakValue * 4})`;
}

/**
 * 按`value`、`total`读取综合力数值条宽度。
 * @param value - 参与综合力数值条宽度比较、格式化或输出的候选值。
 * @param total - 决定综合力数值条宽度内容、边界或目标的 `total` 值。
 * @returns 综合力数值条宽度。
 */
export function getStatLineBarWidth(value: number, total: number): number {
  return (
    ((BANGDREAM_STAT_LIST_SPEC.line.canvas.width * value) / total) *
    BANGDREAM_STAT_LIST_SPEC.line.bar.widthScale
  );
}

/**
 * 根据参数 `value`，生成综合力数值条绘制布局。
 * @param value - 参与根据参数 `value`，生成综合力数值条绘制布局比较、格式化或输出的候选值。
 * @param total - 决定根据参数 `value`，生成综合力数值条绘制布局内容、边界或目标的 `total` 值。
 * @returns 包含 `height`、`radius`、`strokeWidth`、`width`、`x` 字段的根据参数 `value`，生成综合力数值条绘制布局。
 */
export function getStatLineBarLayout(value: number, total: number) {
  const barSpec = BANGDREAM_STAT_LIST_SPEC.line.bar;

  return {
    height: barSpec.height,
    radius: barSpec.radius,
    strokeWidth: barSpec.strokeWidth,
    width: getStatLineBarWidth(value, total),
    x: barSpec.x,
    y: barSpec.y,
  };
}
