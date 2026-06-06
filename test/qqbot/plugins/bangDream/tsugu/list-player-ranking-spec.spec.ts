import {
  BANGDREAM_PLAYER_RANKING_SPEC,
  createRankingDegreeLayout,
  isMedalRanking,
  stripPlayerRankingTextTags,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-player-ranking-spec';

describe('BangDream player ranking spec', () => {
  it('keeps the historical ranking row dimensions stable', () => {
    expect(BANGDREAM_PLAYER_RANKING_SPEC.canvas).toEqual({
      height: 110,
      width: 800,
    });
    expect(BANGDREAM_PLAYER_RANKING_SPEC.headShot).toEqual({
      height: 90,
      width: 90,
      x: 85,
      y: 10,
    });
  });

  it('strips bracket tags from user-facing ranking text', () => {
    expect(stripPlayerRankingTextTags('[JP]Alice[VIP]')).toBe('Alice');
  });

  it('detects medal ranking and calculates degree positions', () => {
    expect(isMedalRanking(1)).toBe(true);
    expect(isMedalRanking(3)).toBe(true);
    expect(isMedalRanking(4)).toBe(false);
    expect(isMedalRanking(undefined)).toBe(false);
    expect(
      createRankingDegreeLayout({ height: 50, index: 2, width: 230 }),
    ).toEqual({
      height: 25,
      width: 115,
      x: 460,
      y: 46,
    });
  });
});
