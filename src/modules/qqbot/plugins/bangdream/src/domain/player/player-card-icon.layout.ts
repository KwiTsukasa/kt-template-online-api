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
 * 计算玩家卡牌列表文本字号。
 *
 * @param lineHeight - lineHeight 输入；限定 BangDream查询范围。
 */
export function getPlayerCardIconListTextSize(lineHeight: number) {
  return lineHeight * BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.textSizeRatio;
}

/**
 * 计算玩家卡牌列表卡牌间距。
 *
 * @param lineHeight - lineHeight 输入；限定 BangDream查询范围。
 */
export function getPlayerCardIconListSpacing(lineHeight: number) {
  return lineHeight * BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.spacingRatio;
}

/**
 * 按历史展示顺序排列玩家主卡组。
 *
 * @param entries - BangDream列表；驱动 `map()` 的 BangDream步骤。
 */
export function sortPlayerMainDeckEntries<T>(entries: T[]): T[] {
  return BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.card.defaultOrder
    .map((index) => entries[index])
    .filter((entry): entry is T => entry !== undefined);
}
