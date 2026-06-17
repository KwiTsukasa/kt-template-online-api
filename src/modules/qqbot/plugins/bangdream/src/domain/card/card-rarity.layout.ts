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
 * @param rarity - rarity 输入；计算 BangDream判断结果。
 * @param trainingStatus - BangDream列表；计算 BangDream判断结果。
 */
export function shouldUseTrainedRarityStar(
  rarity: number,
  trainingStatus: boolean,
) {
  return (
    rarity >= BANGDREAM_RARITY_LIST_SPEC.trainedStar.minRarity && trainingStatus
  );
}
