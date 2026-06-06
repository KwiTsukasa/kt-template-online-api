import {
  BANGDREAM_DEGREE_LIST_SPEC,
  isDegreeRewardType,
  shouldCollectMusicRankingDegreeRewards,
  shouldDrawDegreeDecorations,
  shouldDrawDegreeIcon,
  shouldStopAfterFirstMusicRewardGroup,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/degree-list-spec';

describe('BangDream degree list spec', () => {
  it('keeps badge and list sizes stable', () => {
    expect(BANGDREAM_DEGREE_LIST_SPEC.badge).toMatchObject({
      decoratedMinDegreeIdExclusive: 12,
      height: 50,
      width: 230,
    });
    expect(BANGDREAM_DEGREE_LIST_SPEC.list.textSize).toBe(50);
    expect(BANGDREAM_DEGREE_LIST_SPEC.eventRewards.maxDegreeCount).toBe(6);
  });

  it('keeps degree decoration conditions stable', () => {
    expect(
      shouldDrawDegreeDecorations({ degreeId: 13, degreeType: 'event' }),
    ).toBe(true);
    expect(
      shouldDrawDegreeDecorations({ degreeId: 12, degreeType: 'event' }),
    ).toBe(false);
    expect(
      shouldDrawDegreeDecorations({ degreeId: 13, degreeType: 'normal' }),
    ).toBe(false);
    expect(
      shouldDrawDegreeDecorations({ degreeId: 13, degreeType: null }),
    ).toBe(false);
    expect(shouldDrawDegreeIcon('try_clear')).toBe(false);
    expect(shouldDrawDegreeIcon('event')).toBe(true);
  });

  it('keeps event reward filters stable', () => {
    expect(shouldCollectMusicRankingDegreeRewards('versus')).toBe(true);
    expect(shouldCollectMusicRankingDegreeRewards('challenge')).toBe(true);
    expect(shouldCollectMusicRankingDegreeRewards('medley')).toBe(true);
    expect(shouldCollectMusicRankingDegreeRewards('normal')).toBe(false);
    expect(shouldStopAfterFirstMusicRewardGroup('medley')).toBe(true);
    expect(shouldStopAfterFirstMusicRewardGroup('versus')).toBe(false);
    expect(isDegreeRewardType('degree')).toBe(true);
    expect(isDegreeRewardType('item')).toBe(false);
  });
});
