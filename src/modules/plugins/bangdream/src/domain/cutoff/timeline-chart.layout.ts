import type { ChartDataset } from 'chart.js';

export const BANGDREAM_TIMELINE_CHART_SPEC = {
  animation: false,
  canvas: {
    height: 900,
    width: 800,
  },
  legend: {
    fontSize: 20,
  },
  responsive: false,
  xAxis: {
    unit: 'day',
  },
  yAxis: {
    min: 0,
    padding: 1000,
    scale: 1.1,
  },
} as const;

export interface TimelineChartPoint {
  x: number;
  y: number;
}

export type TimelineChartDataset = ChartDataset<'line', TimelineChartPoint[]>;

/**
 * 根据参数 `datasets`，计算时间线图表的原始 Y 轴最大值。
 * @param datasets - 决定根据参数 `datasets`，计算时间线图表的原始 Y 轴最大值内容、边界或目标的 `datasets` 值。
 * @returns 根据参数 `datasets`，计算时间线图表的原始 Y 轴最大值。
 */
export function getTimelineRawYMax(datasets: TimelineChartDataset[]) {
  return Math.max(
    ...datasets.map((dataset) => Math.max(...dataset.data.map((pt) => pt.y))),
  );
}

/**
 * 按`rawYMax`读取时间线图表 Y 轴显示上限。
 * @param rawYMax - 决定时间线图表 Y 轴显示上限内容、边界或目标的 `rawYMax` 值。
 * @returns 时间线图表 Y 轴显示上限。
 */
export function getTimelineDisplayYMax(rawYMax: number) {
  return (
    (rawYMax + BANGDREAM_TIMELINE_CHART_SPEC.yAxis.padding) *
    BANGDREAM_TIMELINE_CHART_SPEC.yAxis.scale
  );
}
