import { BANGDREAM_CARD_PRIORITY_TYPES } from '@/modules/plugins/bangdream/src/config/runtime-options';

export interface CardIconListSortTarget {
  cardId: number;
  rarity: number;
  type: string;
}

export const BANGDREAM_CARD_ICON_LIST_SPEC = {
  card: {
    priorityTypes: BANGDREAM_CARD_PRIORITY_TYPES,
    showCardId: false,
    showCardType: true,
    showSkillType: true,
  },
  list: {
    defaultLineHeight: 200,
    spacingRatio: 13 / 200,
    textSizeRatio: 180 / 200,
  },
} as const;

/**
 * 按`lineHeight`读取卡牌图标列表文本字号。
 * @param lineHeight - 决定卡牌图标列表文本字号内容、边界或目标的 `lineHeight` 值。
 * @returns 卡牌图标列表文本字号。
 */
export function getCardIconListTextSize(lineHeight: number) {
  return lineHeight * BANGDREAM_CARD_ICON_LIST_SPEC.list.textSizeRatio;
}

/**
 * 按`lineHeight`读取卡牌图标列表卡牌间距。
 * @param lineHeight - 决定卡牌图标列表卡牌间距内容、边界或目标的 `lineHeight` 值。
 * @returns 卡牌图标列表卡牌间距。
 */
export function getCardIconListSpacing(lineHeight: number) {
  return lineHeight * BANGDREAM_CARD_ICON_LIST_SPEC.list.spacingRatio;
}

/**
 * 按历史列表规则比较卡牌图标展示顺序。
 * @param left - 用于按历史列表规则比较卡牌图标展示顺序的领域对象，包含 `rarity`、`type`、`cardId` 字段。
 * @param right - 用于按历史列表规则比较卡牌图标展示顺序的领域对象，包含 `rarity`、`type`、`cardId` 字段。
 * @returns 当前状态对应的按历史列表规则比较卡牌图标展示顺序，取值为 `1`。
 */
export function compareCardIconListCards(
  left: CardIconListSortTarget,
  right: CardIconListSortTarget,
) {
  if (left.rarity !== right.rarity) {
    return right.rarity - left.rarity;
  }

  const priorityTypes = BANGDREAM_CARD_ICON_LIST_SPEC.card
    .priorityTypes as readonly string[];
  const leftTypeIndex = priorityTypes.indexOf(left.type);
  const rightTypeIndex = priorityTypes.indexOf(right.type);
  const leftHasPriority = leftTypeIndex !== -1;
  const rightHasPriority = rightTypeIndex !== -1;

  if (leftHasPriority && !rightHasPriority) {
    return -1;
  }
  if (!leftHasPriority && rightHasPriority) {
    return 1;
  }
  if (leftHasPriority && rightHasPriority) {
    return leftTypeIndex - rightTypeIndex;
  }

  return left.cardId - right.cardId;
}

/**
 * 按卡牌图标列表展示规则原地排序。
 * @param cards - 决定按卡牌图标列表展示规则原地排序内容、边界或目标的 `cards` 值。
 * @returns 按输入顺序得到的按卡牌图标列表展示规则原地排序列表；没有匹配项时为空数组。
 */
export function sortCardIconListCards<T extends CardIconListSortTarget>(
  cards: T[],
): T[] {
  return cards.sort(compareCardIconListCards);
}
