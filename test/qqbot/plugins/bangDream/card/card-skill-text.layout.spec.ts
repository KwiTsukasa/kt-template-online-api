import {
  BANGDREAM_SKILL_TEXT_SPEC,
  createSkillTextFragments,
  getSkillScoreSuffix,
} from '@/qqbot/plugins/bangDream/card/card-skill-text.layout';

describe('BangDream skill text spec', () => {
  it('keeps the historical card skill text layout stable', () => {
    expect(BANGDREAM_SKILL_TEXT_SPEC.layout).toEqual({
      baseOffsetY: 0,
      canvasHeight: 45,
      maxWidth: 250,
      spacing: 3,
      textBasePaddingRight: 15,
      textOffsetX: 5,
      textOffsetY: 0,
      textSize: 27,
      lineHeight: 30,
    });
  });

  it('keeps the score suffix priority stable', () => {
    expect(getSkillScoreSuffix(['score_continued_note_judge'])).toBe('G');
    expect(getSkillScoreSuffix(['score_over_life', 'score_under_life'])).toBe(
      'L',
    );
    expect(getSkillScoreSuffix(['score_over_life'])).toBe('/');
    expect(getSkillScoreSuffix(['score_under_great_half'])).toBe('P');
    expect(getSkillScoreSuffix(['score_perfect'])).toBe('P');
    expect(getSkillScoreSuffix(['score_rate_up_with_perfect'])).toBe('+0.5*P');
    expect(
      getSkillScoreSuffix([
        'score_continued_note_judge',
        'score_rate_up_with_perfect',
      ]),
    ).toBe('G');
  });

  it('creates text and icon fragments in the original effect order', () => {
    expect(
      createSkillTextFragments({
        effectTypes: ['damage', 'score_perfect', 'judge'],
        scoreUpMaxValue: 110,
      }),
    ).toEqual([
      {
        type: 'text',
        value: '110P',
      },
      {
        type: 'icon',
        key: 'damage',
      },
      {
        type: 'icon',
        key: 'judge',
      },
    ]);
  });

  it('omits score text when the skill has no score up value', () => {
    expect(
      createSkillTextFragments({
        effectTypes: ['life'],
        scoreUpMaxValue: 0,
      }),
    ).toEqual([
      {
        type: 'icon',
        key: 'life',
      },
    ]);
  });
});
