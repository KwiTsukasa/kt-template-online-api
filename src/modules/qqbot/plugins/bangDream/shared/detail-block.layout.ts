export const BANGDREAM_DETAIL_BLOCK_SPEC = {
  characterHalf: {
    footerHeight: 100,
    height: 800,
    idTextSize: 30,
    illustrationInsetY: 2,
    illustrationPaddingHeight: 20,
    nameTextSize: 40,
    opaqueOpacity: 1,
    overlayOpacity: 0.25,
    radius: 20,
    strokeWidth: 4,
    width: 250,
  },
  metaList: {
    maxRows: 50,
    percentRoundScale: 100,
    percentScale: 100,
  },
  playerDetail: {
    dataBlockOpacity: 1,
    dataBlockY: 900,
    degreeGapWidth: 20,
    illustrationHeight: 1000,
    illustrationWidth: 1000,
    infoTextSize: 35,
    nameTextSize: 75,
    spacerHeight: 25,
  },
  songDetail: {
    detailSeparator: {
      endX: 360,
      height: 20,
      width: 365,
    },
    detailTextSize: 30,
    difficultyGap: 10,
    difficultyHeight: 60,
    difficultyX: 435,
    horizontalGapWidth: 35,
    jacketMaxWidth: 400,
    metaSeparatorHeight: 10,
    rightBottomGapHeight: 60,
    textMaxWidth: 365,
    titleTextSize: 40,
  },
} as const;

/**
 * 计算歌曲 meta 相对百分比，保持历史两位小数舍入策略。
 *
 * @param meta - 当前歌曲 meta 值。
 * @param maxMeta - 当前榜单最大 meta 值。
 */
export function getRelativeMetaPercent(meta: number, maxMeta: number): number {
  const { percentRoundScale, percentScale } =
    BANGDREAM_DETAIL_BLOCK_SPEC.metaList;
  return (
    Math.round((meta / maxMeta) * percentScale * percentRoundScale) /
    percentRoundScale
  );
}
