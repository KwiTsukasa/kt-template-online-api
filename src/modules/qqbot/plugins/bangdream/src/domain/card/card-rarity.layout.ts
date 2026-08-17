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
 * 根据`rarity`、`trainingStatus`与当前约束判定星级列表是否使用特训后星图。
 * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
 * @param trainingStatus - 决定星级列表是否使用特训后星图内容、边界或目标的 `trainingStatus` 值。
 * @returns 满足星级列表是否使用特训后星图约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function shouldUseTrainedRarityStar(
  rarity: number,
  trainingStatus: boolean,
) {
  return (
    rarity >= BANGDREAM_RARITY_LIST_SPEC.trainedStar.minRarity && trainingStatus
  );
}
