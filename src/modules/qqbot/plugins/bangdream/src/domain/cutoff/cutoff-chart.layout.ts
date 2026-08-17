export const BANGDREAM_CUTOFF_CHART_SPEC = {
  currentTimeDataset: {
    label: '当前时间',
    pointHoverRadius: 15,
    pointRadius: 10,
  },
  emptyCanvas: {
    height: 1,
    width: 1,
  },
  eventTopDataset: {
    borderWidth: 4,
    pointAlpha: 0,
  },
  legend: {
    colorBlockOpacity: 0.8,
    textSize: 20,
  },
  lineDataset: {
    borderWidth: 5,
    predictionBackgroundAlpha: 1,
    predictionBorderAlpha: 1,
    predictionDash: [20, 10],
    predictionPointHoverRadius: 0,
    predictionPointRadius: 0,
    predictionSuffix: '预测线',
    singleLineFillBackgroundAlpha: 0.2,
  },
} as const;

/**
 * 从图表标签中移除方括号装饰。
 * @param text - 决定从图表标签中移除方括号装饰内容、边界或目标的 `text` 值。
 * @returns 从图表标签中移除方括号装饰清理后的文本。
 */
export function stripCutoffChartLabelTags(text: string) {
  return text.replace(/\[[^\]]*\]/g, '');
}
