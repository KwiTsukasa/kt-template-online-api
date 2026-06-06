import {
  BANGDREAM_CUTOFF_CHART_SPEC,
  stripCutoffChartLabelTags,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/cutoff-chart-spec';
import {
  BANGDREAM_TIMELINE_CHART_SPEC,
  getTimelineDisplayYMax,
  getTimelineRawYMax,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/timeline-chart-spec';

describe('BangDream chart specs', () => {
  it('keeps timeline chart dimensions and y-axis padding stable', () => {
    expect(BANGDREAM_TIMELINE_CHART_SPEC.canvas).toEqual({
      height: 900,
      width: 800,
    });
    expect(
      getTimelineRawYMax([
        { data: [{ y: 100 }, { y: 300 }] },
        { data: [{ y: 200 }] },
      ]),
    ).toBe(300);
    expect(getTimelineDisplayYMax(300)).toBeCloseTo(1430);
  });

  it('keeps cutoff chart visual constants and label cleanup stable', () => {
    expect(BANGDREAM_CUTOFF_CHART_SPEC.emptyCanvas).toEqual({
      height: 1,
      width: 1,
    });
    expect(BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionDash).toEqual([
      20, 10,
    ]);
    expect(stripCutoffChartLabelTags('[JP]Player[1]')).toBe('Player');
  });
});
