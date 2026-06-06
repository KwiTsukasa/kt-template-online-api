import {
  BANGDREAM_STAT_LIST_SPEC,
  createStatLineText,
  getStatLineBarLayout,
  getStatLineBarWidth,
} from '@/qqbot/plugins/bangDream/card/card-stat.layout';

describe('BangDream stat list spec', () => {
  it('keeps the historical stat list spacer stable', () => {
    expect(BANGDREAM_STAT_LIST_SPEC.spacer).toEqual({
      height: 5,
      width: 1,
    });
  });

  it('keeps the historical stat line canvas, text and bar layout stable', () => {
    expect(BANGDREAM_STAT_LIST_SPEC.line.canvas).toEqual({
      height: 70,
      width: 800,
    });
    expect(BANGDREAM_STAT_LIST_SPEC.line.text).toEqual({
      lineHeight: 30,
      maxWidth: 800,
      textSize: 30,
      x: 20,
      y: 0,
    });
    expect(BANGDREAM_STAT_LIST_SPEC.line.bar).toEqual({
      height: 30,
      radius: 15,
      strokeWidth: 0,
      widthScale: 2,
      x: 20,
      y: 35,
    });
  });

  it('formats stat line text with optional limit break bonus', () => {
    expect(
      createStatLineText({
        label: '演出',
        value: 10654.9,
      }),
    ).toBe('演出: 10654');
    expect(
      createStatLineText({
        label: '演出',
        limitBreakValue: 800,
        value: 10654.9,
      }),
    ).toBe('演出: 10654 + (3200)');
  });

  it('computes the doubled historical stat bar width and layout', () => {
    expect(getStatLineBarWidth(100, 400)).toBe(400);
    expect(getStatLineBarLayout(100, 400)).toEqual({
      height: 30,
      radius: 15,
      strokeWidth: 0,
      width: 400,
      x: 20,
      y: 35,
    });
  });
});
