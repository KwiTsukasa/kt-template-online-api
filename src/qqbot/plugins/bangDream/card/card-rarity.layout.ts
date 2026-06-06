export const BANGDREAM_RARITY_LIST_SPEC = {
  list: {
    spacing: 0,
    textSize: 50,
  },
  trainedStar: {
    minRarity: 4,
  },
} as const;

/**
 * 判断星级列表是否使用特训后星图。
 *
 * @param rarity - 卡牌稀有度。
 * @param trainingStatus - 是否展示特训后状态。
 */
export function shouldUseTrainedRarityStar(
  rarity: number,
  trainingStatus: boolean,
) {
  return (
    rarity >= BANGDREAM_RARITY_LIST_SPEC.trainedStar.minRarity && trainingStatus
  );
}
