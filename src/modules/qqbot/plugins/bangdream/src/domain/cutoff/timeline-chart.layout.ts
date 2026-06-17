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
 * 计算时间线图表的原始 Y 轴最大值。
 *
 * @param datasets - BangDream列表；转换 BangDream列表项。
 */
export function getTimelineRawYMax(datasets: TimelineChartDataset[]) {
  return Math.max(
    ...datasets.map((dataset) => Math.max(...dataset.data.map((pt) => pt.y))),
  );
}

/**
 * 计算时间线图表 Y 轴显示上限。
 *
 * @param rawYMax - rawYMax 输入；限定 BangDream查询范围。
 */
export function getTimelineDisplayYMax(rawYMax: number) {
  return (
    (rawYMax + BANGDREAM_TIMELINE_CHART_SPEC.yAxis.padding) *
    BANGDREAM_TIMELINE_CHART_SPEC.yAxis.scale
  );
}
