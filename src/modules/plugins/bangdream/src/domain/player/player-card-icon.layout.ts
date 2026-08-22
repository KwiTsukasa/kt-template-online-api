export const BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC = {
  card: {
    defaultOrder: [3, 1, 0, 2, 4],
    showCardType: false,
    showSkillType: true,
  },
  list: {
    defaultLineHeight: 184,
    spacingRatio: 13 / 200,
    textSizeRatio: 180 / 200,
  },
} as const;

/**
 * 按`lineHeight`读取玩家卡牌列表文本字号。
 * @param lineHeight - 决定玩家卡牌列表文本字号内容、边界或目标的 `lineHeight` 值。
 * @returns 玩家卡牌列表文本字号。
 */
export function getPlayerCardIconListTextSize(lineHeight: number) {
  return lineHeight * BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.textSizeRatio;
}

/**
 * 按`lineHeight`读取玩家卡牌列表卡牌间距。
 * @param lineHeight - 决定玩家卡牌列表卡牌间距内容、边界或目标的 `lineHeight` 值。
 * @returns 玩家卡牌列表卡牌间距。
 */
export function getPlayerCardIconListSpacing(lineHeight: number) {
  return lineHeight * BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.spacingRatio;
}

/**
 * 按历史展示顺序排列玩家主卡组。
 * @param entries - 按原有顺序参与按历史展示顺序排列玩家主卡组筛选、合并或汇总的集合。
 * @returns 按输入顺序得到的按历史展示顺序排列玩家主卡组列表；没有匹配项时为空数组。
 */
export function sortPlayerMainDeckEntries<T>(entries: T[]): T[] {
  return BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.card.defaultOrder
    .map((index) => entries[index])
    .filter((entry): entry is T => entry !== undefined);
}
