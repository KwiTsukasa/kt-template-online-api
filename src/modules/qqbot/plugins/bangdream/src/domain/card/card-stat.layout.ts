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
 * 创建综合力数值行展示文本。
 *
 * @param params - 数值行文本参数。
 */
export function createStatLineText(params: StatLineTextParams): string {
  const baseText = `${params.label}: ${Math.floor(params.value)}`;

  if (params.limitBreakValue == null) {
    return baseText;
  }

  return `${baseText} + (${params.limitBreakValue * 4})`;
}

/**
 * 计算综合力数值条宽度。
 *
 * @param value - 当前数值。
 * @param total - 综合力总数值。
 */
export function getStatLineBarWidth(value: number, total: number): number {
  return (
    ((BANGDREAM_STAT_LIST_SPEC.line.canvas.width * value) / total) *
    BANGDREAM_STAT_LIST_SPEC.line.bar.widthScale
  );
}

/**
 * 生成综合力数值条绘制布局。
 *
 * @param value - 当前数值。
 * @param total - 综合力总数值。
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
