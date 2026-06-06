import {
  BANGDREAM_EVENT_STAGE_SPEC,
  getEventStageSongCellHeight,
  getEventStageSongCellWidth,
  getEventStageSongJacketHeight,
  getEventStageSongRowSize,
  shouldStartNewEventStageColumn,
  splitEventStageImagesByColumnHeight,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/event-stage-spec';

describe('BangDream event stage spec', () => {
  it('keeps song row dimensions compatible with existing layout', () => {
    expect(getEventStageSongCellWidth()).toBe(100);
    expect(getEventStageSongJacketHeight()).toBe(94);
    expect(getEventStageSongCellHeight()).toBeCloseTo((100 / 180) * 210, 6);
    expect(getEventStageSongRowSize()).toEqual({
      height: getEventStageSongCellHeight() + 10,
      width: 800,
    });
  });

  it('keeps type top text and column limits stable', () => {
    expect(BANGDREAM_EVENT_STAGE_SPEC.typeTop.fontSize).toBe(25);
    expect(BANGDREAM_EVENT_STAGE_SPEC.typeTop.strokeWidth).toBe(4.5);
    expect(BANGDREAM_EVENT_STAGE_SPEC.list.maxColumnHeight).toBe(6000);
  });

  it('splits stage images by max column height', () => {
    const columns = splitEventStageImagesByColumnHeight([
      { height: 2000, id: 1 },
      { height: 3000, id: 2 },
      { height: 1500, id: 3 },
      { height: 1000, id: 4 },
    ]);

    expect(columns.map((column) => column.map((item) => item.id))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('detects whether the next stage image should start a new column', () => {
    expect(shouldStartNewEventStageColumn(5000, 1000, 2)).toBe(false);
    expect(shouldStartNewEventStageColumn(5000, 1001, 2)).toBe(true);
    expect(shouldStartNewEventStageColumn(0, 7000, 0)).toBe(false);
  });

  it('keeps oversized first image in its own column', () => {
    const columns = splitEventStageImagesByColumnHeight(
      [
        { height: 7000, id: 1 },
        { height: 100, id: 2 },
      ],
      6000,
    );

    expect(columns.map((column) => column.map((item) => item.id))).toEqual([
      [1],
      [2],
    ]);
  });
});
