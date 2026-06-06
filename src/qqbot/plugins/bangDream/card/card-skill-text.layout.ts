export const BANGDREAM_SKILL_TEXT_SPEC = {
  iconKeys: ['judge', 'life', 'damage'],
  layout: {
    baseOffsetY: 0,
    canvasHeight: 45,
    maxWidth: 250,
    spacing: 3,
    textBasePaddingRight: 15,
    textOffsetX: 5,
    textOffsetY: 0,
    textSize: 27,
    lineHeight: 30,
  },
} as const;

export type BangDreamSkillIconKey =
  (typeof BANGDREAM_SKILL_TEXT_SPEC.iconKeys)[number];

export type BangDreamSkillTextFragment =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'icon';
      key: BangDreamSkillIconKey;
    };

const BANGDREAM_SKILL_SCORE_SUFFIX_RULES = [
  {
    suffix: 'G',
    matches: (effectTypes: readonly string[]) =>
      effectTypes.includes('score_continued_note_judge'),
  },
  {
    suffix: 'L',
    matches: (effectTypes: readonly string[]) =>
      effectTypes.includes('score_over_life') &&
      effectTypes.includes('score_under_life'),
  },
  {
    suffix: '/',
    matches: (effectTypes: readonly string[]) =>
      effectTypes.includes('score_over_life'),
  },
  {
    suffix: 'P',
    matches: (effectTypes: readonly string[]) =>
      effectTypes.includes('score_under_great_half') ||
      effectTypes.includes('score_perfect'),
  },
  {
    suffix: '+0.5*P',
    matches: (effectTypes: readonly string[]) =>
      effectTypes.includes('score_rate_up_with_perfect'),
  },
] as const;

/**
 * 生成技能角标里分数值后面展示的规则后缀。
 *
 * @param effectTypes - 技能效果类型列表。
 */
export function getSkillScoreSuffix(effectTypes: readonly string[]) {
  return (
    BANGDREAM_SKILL_SCORE_SUFFIX_RULES.find(({ matches }) =>
      matches(effectTypes),
    )?.suffix ?? ''
  );
}

/**
 * 生成技能角标的文本和图标片段。
 *
 * @param options - 分数加成和技能效果类型。
 */
export function createSkillTextFragments({
  effectTypes,
  scoreUpMaxValue,
}: {
  effectTypes: readonly string[];
  scoreUpMaxValue: number;
}): BangDreamSkillTextFragment[] {
  const fragments: BangDreamSkillTextFragment[] = [];

  if (scoreUpMaxValue !== 0) {
    fragments.push({
      type: 'text',
      value: `${scoreUpMaxValue}${getSkillScoreSuffix(effectTypes)}`,
    });
  }

  effectTypes.forEach((effectType) => {
    if (
      BANGDREAM_SKILL_TEXT_SPEC.iconKeys.includes(
        effectType as BangDreamSkillIconKey,
      )
    ) {
      fragments.push({
        type: 'icon',
        key: effectType as BangDreamSkillIconKey,
      });
    }
  });

  return fragments;
}
