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
 * 计算乐队详情 Logo 缩放参数，并输出固定投影 `widthMax` 字段。
 * @returns 包含 `widthMax` 字段的Band详情Logo布局规格。
 */
export function createBandDetailLogoSpec() {
  return {
    widthMax: BANGDREAM_BAND_DETAIL_LIST_SPEC.item.logoWidth,
  };
}

/**
 * 计算乐队详情正文绘制参数，并输出固定投影 `lineHeight`、`maxWidth` 字段。
 * @returns 包含 `lineHeight`、`maxWidth` 字段的Band详情文本布局规格。
 */
export function createBandDetailTextSpec() {
  const item = BANGDREAM_BAND_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算乐队详情项画布和内容位置，并输出固定投影 `canvasHeight`、`canvasWidth`、`logoX`、`logoY`、`textX` 字段。
 * @param contentImage - 用于Band详情条目布局的领域对象，包含 `width` 字段。
 * @returns 包含 `canvasHeight`、`canvasWidth`、`logoX`、`logoY`、`textX` 字段的Band详情条目布局。
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
 * 计算乐队详情列表传给通用列表框架的尺寸，并输出固定投影 `lineHeight`、`spacing`、`textSize` 字段。
 * @param firstItem - 用于Band详情边框布局规格的领域对象，包含 `height` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `lineHeight`、`spacing`、`textSize` 字段的Band详情边框布局规格。
 */
export function createBandDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_BAND_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}

/**
 * 计算乐队编成等级画布尺寸，并输出固定投影 `height`、`width` 字段。
 * @returns 包含 `height`、`width` 字段的Deck排名Canvas布局规格。
 */
export function createDeckRankCanvasSpec() {
  const deckRank = BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank;
  return {
    height: deckRank.height,
    width: deckRank.width,
  };
}

/**
 * 计算乐队编成等级图片位置，并输出固定投影 `rankX`、`rankY` 字段。
 * @param rankImage - 用于Deck排名图片布局的领域对象，包含 `width` 字段。
 * @param levelImage - 用于Deck排名图片布局的领域对象，包含 `width` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `rankX`、`rankY` 字段的Deck排名图片布局。
 */
export function createDeckRankImageLayout(
  rankImage: ImageLike,
  levelImage?: ImageLike,
) {
  const deckRank = BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank;
  return {
    rankX: (deckRank.width - rankImage.width) / 2,
    rankY: 0,
    ...((() => {
      if (levelImage) {
        return {
          levelX:
            (deckRank.width + rankImage.width) / 2 +
            deckRank.levelOffsetX -
            levelImage.width,
          levelY: deckRank.levelY,
        };
      }
      return {};
    })()),
  };
}

/**
 * 计算乐队编成等级的等级图片缩放参数，并输出固定投影 `heightMax` 字段。
 * @returns 包含 `heightMax` 字段的Deck排名Level图片布局规格。
 */
export function createDeckRankLevelImageSpec() {
  return {
    heightMax: BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank.levelHeight,
  };
}

/**
 * 计算可用于等级图片文件名的 Rank ID。
 * @param rankId - 用于精确定位排名的标识。
 * @returns 可用于等级图片文件名的 Rank ID。
 */
export function normalizeDeckRankLevelSpriteRankId(rankId: number) {
  const maxRankId =
    BANGDREAM_BAND_DETAIL_LIST_SPEC.deckRank.maxLevelSpriteRankId;
  if (rankId > maxRankId) {
    return maxRankId;
  }
  return rankId;
}
