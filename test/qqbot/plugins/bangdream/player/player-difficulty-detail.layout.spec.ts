import {
  BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC,
  createDifficultyDetailBadgeSpec,
  createDifficultyDetailItemLayout,
  createDifficultyDetailListFrameSpec,
  createDifficultyDetailTextSpec,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-difficulty-detail.layout';

describe('BangDream difficulty detail list spec', () => {
  it('keeps difficulty detail item constants stable', () => {
    expect(BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.item).toEqual({
      badgeRadius: 5,
      badgeTextSize: 30,
      badgeWidth: 140,
      textLineHeight: 40,
      textOffsetY: 50,
      width: 152,
    });
    expect(BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.list.spacing).toBe(0);
  });

  it('creates badge spec with historical uppercase text', () => {
    expect(createDifficultyDetailBadgeSpec('expert', '#ff0000')).toEqual({
      color: '#ff0000',
      radius: 5,
      text: 'EXPERT',
      textSize: 30,
      width: 140,
    });
  });

  it('keeps text drawing spec stable', () => {
    expect(createDifficultyDetailTextSpec()).toEqual({
      lineHeight: 40,
      maxWidth: 152,
    });
  });

  it('keeps item layout offsets stable', () => {
    expect(createDifficultyDetailItemLayout({ height: 72, width: 88 })).toEqual(
      {
        badgeX: 6,
        badgeY: 0,
        canvasHeight: 122,
        canvasWidth: 152,
        textX: 32,
        textY: 50,
      },
    );
  });

  it('keeps list frame values derived from the first item', () => {
    expect(
      createDifficultyDetailListFrameSpec({ height: 122, width: 152 }),
    ).toEqual({
      lineHeight: 122,
      spacing: 0,
      textSize: 122,
    });
  });
});
