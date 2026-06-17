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
 * 计算难度详情项徽章绘制参数。
 *
 * @param difficultyName - difficultyName 输入；执行 `difficultyName.toUpperCase()` 对应的 BangDream步骤。
 * @param color - color 输入；生成 BangDream对象。
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
 * 计算难度详情正文绘制参数。
 */
export function createDifficultyDetailTextSpec() {
  const item = BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算难度详情项画布和内容位置。
 *
 * @param contentImage - contentImage 输入；使用 `height`、`width` 字段生成结果。
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
 * 计算难度详情列表传给通用列表框架的尺寸。
 *
 * @param firstItem - firstItem 输入；生成 BangDream对象。
 */
export function createDifficultyDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_DIFFICULTY_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}
