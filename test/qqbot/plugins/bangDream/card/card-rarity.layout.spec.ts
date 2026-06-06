import {
  BANGDREAM_RARITY_LIST_SPEC,
  shouldUseTrainedRarityStar,
} from '@/qqbot/plugins/bangDream/card/card-rarity.layout';

describe('BangDream rarity list spec', () => {
  it('keeps the historical rarity list text size and spacing stable', () => {
    expect(BANGDREAM_RARITY_LIST_SPEC.list).toEqual({
      spacing: 0,
      textSize: 50,
    });
  });

  it('keeps the trained star threshold stable', () => {
    expect(BANGDREAM_RARITY_LIST_SPEC.trainedStar.minRarity).toBe(4);
    expect(shouldUseTrainedRarityStar(3, true)).toBe(false);
    expect(shouldUseTrainedRarityStar(4, true)).toBe(true);
    expect(shouldUseTrainedRarityStar(5, true)).toBe(true);
    expect(shouldUseTrainedRarityStar(4, false)).toBe(false);
  });
});
