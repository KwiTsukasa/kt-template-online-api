import {
  BANGDREAM_CHARACTER_DETAIL_LIST_SPEC,
  createCharacterDetailIconSpec,
  createCharacterDetailItemLayout,
  createCharacterDetailListFrameSpec,
  createCharacterDetailTextSpec,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-character-detail.layout';

describe('BangDream character detail list spec', () => {
  it('keeps character detail item constants stable', () => {
    expect(BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item).toEqual({
      height: 100,
      iconWidth: 50,
      textLineHeight: 40,
      textOffsetY: 50,
      width: 76,
    });
    expect(BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.list.spacing).toBe(0);
  });

  it('creates icon and text drawing specs', () => {
    expect(createCharacterDetailIconSpec()).toEqual({ widthMax: 50 });
    expect(createCharacterDetailTextSpec()).toEqual({
      lineHeight: 40,
      maxWidth: 76,
    });
  });

  it('keeps character detail item layout stable', () => {
    expect(createCharacterDetailItemLayout({ height: 36, width: 32 })).toEqual({
      canvasHeight: 100,
      canvasWidth: 76,
      iconX: 13,
      iconY: 0,
      textX: 22,
      textY: 50,
    });
  });

  it('keeps list frame values derived from the first item', () => {
    expect(
      createCharacterDetailListFrameSpec({ height: 100, width: 76 }),
    ).toEqual({
      lineHeight: 100,
      spacing: 0,
      textSize: 100,
    });
  });
});
