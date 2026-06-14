import {
  BANGDREAM_GACHA_SIMULATE_SPEC,
  createGachaBannerCanvasSize,
  createGachaSimulateWrapOptions,
  getGachaBannerImageMaxWidth,
  getGachaCountTextPosition,
  getGachaDuplicateIconRect,
  getGachaDuplicateLayerCount,
  getGachaSimulateGridMaxWidth,
} from '@/modules/qqbot/plugins/bangDream/gacha/gacha-simulate.layout';

describe('BangDream gacha simulate spec', () => {
  it('keeps grid widths and wrap modes stable', () => {
    expect(getGachaSimulateGridMaxWidth()).toBe(1150);
    expect(createGachaSimulateWrapOptions('single')).toEqual({
      lineHeight: 230,
      maxWidth: 1150,
      spacing: 0,
      textSize: 230,
    });
    expect(createGachaSimulateWrapOptions('summary')).toEqual({
      lineHeight: 115,
      maxWidth: 1150,
      spacing: 0,
      textSize: 115,
    });
  });

  it('caps duplicate card shadow layers', () => {
    expect(getGachaDuplicateLayerCount(1)).toBe(0);
    expect(getGachaDuplicateLayerCount(2)).toBe(1);
    expect(getGachaDuplicateLayerCount(99)).toBe(
      BANGDREAM_GACHA_SIMULATE_SPEC.card.duplicateIcon.maxLayerCount,
    );
  });

  it('positions duplicate card layers from back to front', () => {
    expect(getGachaDuplicateIconRect(0, 6)).toEqual({
      height: 180,
      width: 180,
      x: 11,
      y: -4,
    });
    expect(getGachaDuplicateIconRect(5, 6)).toEqual({
      height: 180,
      width: 180,
      x: 31,
      y: 16,
    });
  });

  it('keeps count text and banner layout stable', () => {
    expect(getGachaCountTextPosition(42)).toEqual({ x: 173, y: 195 });
    expect(getGachaBannerImageMaxWidth()).toBe(575);
    expect(createGachaBannerCanvasSize(320)).toEqual({
      height: 320,
      width: 1350,
    });
  });
});
