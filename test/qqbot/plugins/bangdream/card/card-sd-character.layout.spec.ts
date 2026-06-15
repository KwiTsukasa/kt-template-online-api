import {
  BANGDREAM_CARD_SD_CHARACTER_SPEC,
  getCardSdCharacterCropRect,
  getCardSdCharacterCropRects,
  getCardSdCharacterListLineHeight,
  getCardSdCharacterListTextSize,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-sd-character.layout';

describe('BangDream card SD character list spec', () => {
  it('keeps the historical four-frame SD character crop grid', () => {
    expect(getCardSdCharacterCropRects()).toEqual([
      { sourceX: 0, sourceY: 84, width: 400, height: 470 },
      { sourceX: 400, sourceY: 84, width: 400, height: 470 },
      { sourceX: 0, sourceY: 554, width: 400, height: 470 },
      { sourceX: 400, sourceY: 554, width: 400, height: 470 },
    ]);
  });

  it('computes individual crop rects from the shared sprite spec', () => {
    expect(getCardSdCharacterCropRect(3)).toEqual({
      sourceX: 400,
      sourceY: 554,
      width: 400,
      height: 470,
    });
  });

  it('keeps list line height, text size and spacing stable', () => {
    expect(BANGDREAM_CARD_SD_CHARACTER_SPEC.list.spacing).toBe(0);
    expect(getCardSdCharacterListLineHeight()).toBe(223.25);
    expect(getCardSdCharacterListTextSize()).toBe(223.25);
  });
});
