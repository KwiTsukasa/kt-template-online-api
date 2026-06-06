import {
  BANGDREAM_DIFFICULTY_LIST_SPEC,
  createDifficultyBadgeLayout,
  createDifficultyLevelTextSpec,
  getDifficultyBadgeColor,
  getDifficultyLevelTextPosition,
  getDifficultyListCanvasWidth,
  getDifficultyListItemX,
} from '@/qqbot/plugins/bangDream/song/song-difficulty.layout';

describe('BangDream difficulty list spec', () => {
  it('keeps default difficulty list dimensions stable', () => {
    expect(BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultImageHeight).toBe(60);
    expect(BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultSpacing).toBe(10);
    expect(getDifficultyListCanvasWidth(5, 60, 10)).toBe(340);
    expect(getDifficultyListItemX(3, 60, 10)).toBe(210);
  });

  it('keeps difficulty badge color fallback stable', () => {
    expect(getDifficultyBadgeColor(1, ['#111111', '#222222'])).toBe('#222222');
    expect(getDifficultyBadgeColor(6, ['#111111', '#222222'])).toBe(
      '#f1f1f1',
    );
  });

  it('keeps difficulty badge circle layout stable', () => {
    expect(createDifficultyBadgeLayout(45)).toEqual({
      arcEnd: Math.PI * 2,
      arcRadius: 22.5,
      arcStart: 0,
      arcX: 22.5,
      arcY: 22.5,
      canvasHeight: 45,
      canvasWidth: 45,
    });
  });

  it('keeps difficulty level text layout stable', () => {
    expect(createDifficultyLevelTextSpec(45, 26)).toEqual({
      maxWidth: 135,
      text: '26',
      textSize: 30,
    });
    expect(getDifficultyLevelTextPosition(45, { height: 12, width: 20 })).toEqual(
      {
        x: 12.5,
        y: 16.5,
      },
    );
  });
});
