interface ImageLike {
  height: number;
  width: number;
}

export const BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC = {
  item: {
    badgeRadius: 5,
    badgeTextSize: 30,
    badgeWidth: 140,
    textLineHeight: 40,
    textOffsetY: 50,
    width: 152,
  },
  list: {
    spacing: 0,
  },
} as const;

/**
 * 根据`difficultyName`、`color`构造难度详情项徽章绘制参数。
 * @param difficultyName - 决定难度详情项徽章绘制参数内容、边界或目标的 `difficultyName` 值。
 * @param color - 决定难度详情项徽章绘制参数内容、边界或目标的 `color` 值。
 * @returns 包含 `color`、`radius`、`text`、`textSize`、`width` 字段的难度详情项徽章绘制参数。
 */
export function createDifficultyDetailBadgeSpec(
  difficultyName: string,
  color: string,
) {
  const item = BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.item;
  return {
    color,
    radius: item.badgeRadius,
    text: difficultyName.toUpperCase(),
    textSize: item.badgeTextSize,
    width: item.badgeWidth,
  };
}

/**
 * 计算难度详情正文绘制参数，并输出固定投影 `lineHeight`、`maxWidth` 字段。
 * @returns 包含 `lineHeight`、`maxWidth` 字段的难度详情文本布局规格。
 */
export function createDifficultyDetailTextSpec() {
  const item = BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算难度详情项画布和内容位置，并输出固定投影 `badgeX`、`badgeY`、`canvasHeight`、`canvasWidth`、`textX` 字段。
 * @param contentImage - 用于难度详情条目布局的领域对象，包含 `height`、`width` 字段。
 * @returns 包含 `badgeX`、`badgeY`、`canvasHeight`、`canvasWidth`、`textX` 字段的难度详情条目布局。
 */
export function createDifficultyDetailItemLayout(contentImage: ImageLike) {
  const item = BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.item;
  return {
    badgeX: (item.width - item.badgeWidth) / 2,
    badgeY: 0,
    canvasHeight: contentImage.height + item.textOffsetY,
    canvasWidth: item.width,
    textX: item.width / 2 - contentImage.width / 2,
    textY: item.textOffsetY,
  };
}

/**
 * 计算难度详情列表传给通用列表框架的尺寸，并输出固定投影 `lineHeight`、`spacing`、`textSize` 字段。
 * @param firstItem - 用于难度详情边框布局规格的领域对象，包含 `height` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `lineHeight`、`spacing`、`textSize` 字段的难度详情边框布局规格。
 */
export function createDifficultyDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}
