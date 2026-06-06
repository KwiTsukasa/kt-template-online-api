import {
  BANGDREAM_BAND_DETAIL_LIST_SPEC,
  createBandDetailItemLayout,
  createBandDetailListFrameSpec,
  createBandDetailLogoSpec,
  createBandDetailTextSpec,
  createDeckRankCanvasSpec,
  createDeckRankImageLayout,
  createDeckRankLevelImageSpec,
  normalizeDeckRankLevelSpriteRankId,
} from '@/qqbot/plugins/bangDream/player/player-band-detail.layout';

describe('BangDream band detail list spec', () => {
  it('keeps band detail item constants stable', () => {
    expect(BANGDREAM_BAND_DETAIL_LIST_SPEC.item).toEqual({
      height: 100,
      logoWidth: 110,
      textLineHeight: 40,
      textOffsetY: 50,
      width: 152,
    });
    expect(BANGDREAM_BAND_DETAIL_LIST_SPEC.list.spacing).toBe(0);
  });

  it('creates logo and text drawing specs', () => {
    expect(createBandDetailLogoSpec()).toEqual({ widthMax: 110 });
    expect(createBandDetailTextSpec()).toEqual({
      lineHeight: 40,
      maxWidth: 152,
    });
  });

  it('keeps band detail item layout stable', () => {
    expect(createBandDetailItemLayout({ height: 36, width: 48 })).toEqual({
      canvasHeight: 100,
      canvasWidth: 152,
      logoX: 21,
      logoY: 0,
      textX: 52,
      textY: 50,
    });
  });

  it('keeps list frame values derived from the first item', () => {
    expect(createBandDetailListFrameSpec({ height: 100, width: 152 })).toEqual({
      lineHeight: 100,
      spacing: 0,
      textSize: 100,
    });
  });

  it('keeps deck rank canvas and image layout stable', () => {
    expect(createDeckRankCanvasSpec()).toEqual({ height: 100, width: 150 });
    expect(createDeckRankLevelImageSpec()).toEqual({ heightMax: 50 });
    expect(createDeckRankImageLayout({ height: 32, width: 84 })).toEqual({
      rankX: 33,
      rankY: 0,
    });
    expect(
      createDeckRankImageLayout(
        { height: 32, width: 84 },
        { height: 20, width: 30 },
      ),
    ).toEqual({
      levelX: 89,
      levelY: 45,
      rankX: 33,
      rankY: 0,
    });
  });

  it('keeps deck rank level sprite rank id cap stable', () => {
    expect(normalizeDeckRankLevelSpriteRankId(3)).toBe(3);
    expect(normalizeDeckRankLevelSpriteRankId(5)).toBe(4);
  });
});
