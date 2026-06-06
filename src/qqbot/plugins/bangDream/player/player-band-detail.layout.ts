interface ImageLike {
  height: number;
  width: number;
}

export const BANGDREAM_BAND_DETAIL_LIST_SPEC = {
  deckRank: {
    height: 100,
    levelHeight: 50,
    levelOffsetX: 2,
    levelY: 45,
    maxLevelSpriteRankId: 4,
    width: 150,
  },
  item: {
    height: 100,
    logoWidth: 110,
    textLineHeight: 40,
    textOffsetY: 50,
    width: 152,
  },
  list: {
    spacing: 0,
  },
} as const;

/**
 * 计算乐队详情 Logo 缩放参数。
 */
export function createBandDetailLogoSpec() {
  return {
    widthMax: BANGDREAM_BAND_DETAIL_LIST_SPEC.item.logoWidth,
  };
}

/**
 * 计算乐队详情正文绘制参数。
 */
export function createBandDetailTextSpec() {
  const item = BANGDREAM_BAND_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算乐队详情项画布和内容位置。
 *
 * @param contentImage - 正文图片尺寸。
 */
export function createBandDetailItemLayout(contentImage: ImageLike) {
  const item = BANGDREAM_BAND_DETAIL_LIST_SPEC.item;
  return {
    canvasHeight: item.height,
    canvasWidth: item.width,
    logoX: (item.width - item.logoWidth) / 2,
    logoY: 0,
    textX: item.width / 2 - contentImage.width / 2,
    textY: item.textOffsetY,
  };
}

/**
 * 计算乐队详情列表传给通用列表框架的尺寸。
 *
 * @param firstItem - 第一个乐队详情项。
 */
export function createBandDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_BAND_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}

/**
 * 计算乐队编成等级画布尺寸。
 */
export function createDeckRankCanvasSpec() {
  const deckRank = BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank;
  return {
    height: deckRank.height,
    width: deckRank.width,
  };
}

/**
 * 计算乐队编成等级图片位置。
 *
 * @param rankImage - Rank 主图片尺寸。
 * @param levelImage - Rank 等级图片尺寸。
 */
export function createDeckRankImageLayout(
  rankImage: ImageLike,
  levelImage?: ImageLike,
) {
  const deckRank = BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank;
  return {
    rankX: (deckRank.width - rankImage.width) / 2,
    rankY: 0,
    ...(levelImage
      ? {
          levelX:
            (deckRank.width + rankImage.width) / 2 +
            deckRank.levelOffsetX -
            levelImage.width,
          levelY: deckRank.levelY,
        }
      : {}),
  };
}

/**
 * 计算乐队编成等级的等级图片缩放参数。
 */
export function createDeckRankLevelImageSpec() {
  return {
    heightMax: BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank.levelHeight,
  };
}

/**
 * 计算可用于等级图片文件名的 Rank ID。
 *
 * @param rankId - 原始 Rank ID。
 */
export function normalizeDeckRankLevelSpriteRankId(rankId: number) {
  const maxRankId = BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank.maxLevelSpriteRankId;
  return rankId > maxRankId ? maxRankId : rankId;
}
