import { BangDreamCardType } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-protocol';
import {
  BANGDREAM_CARD_ICON_LIST_SPEC,
  compareCardIconListCards,
  getCardIconListSpacing,
  getCardIconListTextSize,
  sortCardIconListCards,
} from '@/modules/qqbot/plugins/bangDream/card/card-icon.layout';

describe('BangDream card icon list spec', () => {
  it('keeps card icon list text and spacing ratios stable', () => {
    const lineHeight = BANGDREAM_CARD_ICON_LIST_SPEC.list.defaultLineHeight;

    expect(lineHeight).toBe(200);
    expect(getCardIconListTextSize(lineHeight)).toBe(180);
    expect(getCardIconListSpacing(lineHeight)).toBe(13);
  });

  it('sorts higher rarity cards before lower rarity cards', () => {
    const cards = [
      { cardId: 1, rarity: 3, type: BangDreamCardType.permanent },
      { cardId: 2, rarity: 5, type: BangDreamCardType.permanent },
      { cardId: 3, rarity: 4, type: BangDreamCardType.permanent },
    ];

    expect(sortCardIconListCards(cards).map((card) => card.cardId)).toEqual([
      2, 3, 1,
    ]);
  });

  it('keeps priority card types before normal cards at the same rarity', () => {
    const cards = [
      { cardId: 1, rarity: 5, type: BangDreamCardType.permanent },
      { cardId: 2, rarity: 5, type: BangDreamCardType.limited },
      { cardId: 3, rarity: 5, type: BangDreamCardType.dreamfes },
      { cardId: 4, rarity: 5, type: BangDreamCardType.kirafes },
      { cardId: 5, rarity: 5, type: BangDreamCardType.birthday },
    ];

    expect(sortCardIconListCards(cards).map((card) => card.cardId)).toEqual([
      4, 3, 2, 5, 1,
    ]);
  });

  it('sorts normal cards by card id when rarity is the same', () => {
    const cards = [
      { cardId: 10, rarity: 4, type: BangDreamCardType.event },
      { cardId: 8, rarity: 4, type: BangDreamCardType.permanent },
      { cardId: 9, rarity: 4, type: BangDreamCardType.initial },
    ];

    expect(sortCardIconListCards(cards).map((card) => card.cardId)).toEqual([
      8, 9, 10,
    ]);
  });

  it('exposes the same comparison result used by in-place sorting', () => {
    const limited = {
      cardId: 1,
      rarity: 5,
      type: BangDreamCardType.limited,
    };
    const permanent = {
      cardId: 2,
      rarity: 5,
      type: BangDreamCardType.permanent,
    };

    expect(compareCardIconListCards(limited, permanent)).toBeLessThan(0);
  });
});
