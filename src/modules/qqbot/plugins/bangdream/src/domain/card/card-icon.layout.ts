import { BANGDREAM_CARD_PRIORITY_TYPES } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';

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
 * 计算卡牌图标列表文本字号。
 *
 * @param lineHeight - lineHeight 输入；限定 BangDream查询范围。
 */
export function getCardIconListTextSize(lineHeight: number) {
  return lineHeight * BANGDREAM_CARD_ICON_LIST_SPEC.list.textSizeRatio;
}

/**
 * 计算卡牌图标列表卡牌间距。
 *
 * @param lineHeight - lineHeight 输入；限定 BangDream查询范围。
 */
export function getCardIconListSpacing(lineHeight: number) {
  return lineHeight * BANGDREAM_CARD_ICON_LIST_SPEC.list.spacingRatio;
}

/**
 * 按历史列表规则比较卡牌图标展示顺序。
 *
 * @param left - left 输入；使用 `rarity`、`type`、`cardId` 字段生成结果。
 * @param right - right 输入；使用 `rarity`、`type`、`cardId` 字段生成结果。
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
 *
 * @param cards - 卡牌列表；执行 `cards.sort()` 对应的 BangDream步骤。
 */
export function sortCardIconListCards<T extends CardIconListSortTarget>(
  cards: T[],
): T[] {
  return cards.sort(compareCardIconListCards);
}
