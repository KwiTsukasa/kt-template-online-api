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
 * 根据参数 `effectTypes`，生成技能角标里分数值后面展示的规则后缀。
 * @param effectTypes - 决定根据参数 `effectTypes`，生成技能角标里分数值后面展示的规则后缀内容、边界或目标的 `effectTypes` 值。
 * @returns 规范化后的SkillScoreSuffix；主值为空时采用 `''` 兜底。
 */
export function getSkillScoreSuffix(effectTypes: readonly string[]) {
  return (
    BANGDREAM_SKILL_SCORE_SUFFIX_RULES.find(({ matches }) =>
      matches(effectTypes),
    )?.suffix ?? ''
  );
}

/**
 * 根据技能得分、效果类型与图标规则生成按展示顺序排列的文本和图标片段。
 * @returns 按输入顺序得到的根据技能得分、效果类型与图标规则生成按展示顺序排列的文本和图标片段列表；没有匹配项时为空数组。
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
