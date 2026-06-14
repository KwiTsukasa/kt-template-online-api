interface ImageLike {
  height: number;
  width: number;
}

export const BANGDREAM_DIFFICULTY_LIST_SPEC = {
  badge: {
    arcStart: 0,
    fallbackColor: '#f1f1f1',
    fullCircleRadian: Math.PI * 2,
    textMaxWidthRatio: 3,
    textSizeRatio: 2 / 3,
  },
  list: {
    defaultImageHeight: 60,
    defaultSpacing: 10,
  },
} as const;

/**
 * 计算难度列表画布宽度。
 *
 * @param difficultyCount - 难度数量。
 * @param imageHeight - 单个难度徽章高度。
 * @param spacing - 难度徽章间距。
 */
export function getDifficultyListCanvasWidth(
  difficultyCount: number,
  imageHeight: number,
  spacing: number,
) {
  return imageHeight * difficultyCount + (difficultyCount - 1) * spacing;
}

/**
 * 计算难度徽章在列表中的横向位置。
 *
 * @param index - 难度下标。
 * @param imageHeight - 单个难度徽章高度。
 * @param spacing - 难度徽章间距。
 */
export function getDifficultyListItemX(
  index: number,
  imageHeight: number,
  spacing: number,
) {
  return index * (imageHeight + spacing);
}

/**
 * 获取难度徽章颜色。
 *
 * @param difficultyType - 难度类型。
 * @param colors - 难度颜色表。
 */
export function getDifficultyBadgeColor(
  difficultyType: number,
  colors: ReadonlyArray<string | undefined>,
) {
  return (
    colors[difficultyType] ?? BANGDREAM_DIFFICULTY_LIST_SPEC.badge.fallbackColor
  );
}

/**
 * 计算难度徽章圆形布局。
 *
 * @param imageHeight - 难度徽章高度。
 */
export function createDifficultyBadgeLayout(imageHeight: number) {
  return {
    arcEnd: BANGDREAM_DIFFICULTY_LIST_SPEC.badge.fullCircleRadian,
    arcRadius: imageHeight / 2,
    arcStart: BANGDREAM_DIFFICULTY_LIST_SPEC.badge.arcStart,
    arcX: imageHeight / 2,
    arcY: imageHeight / 2,
    canvasHeight: imageHeight,
    canvasWidth: imageHeight,
  };
}

/**
 * 计算难度等级文字绘制参数。
 *
 * @param imageHeight - 难度徽章高度。
 * @param playLevel - 谱面等级。
 */
export function createDifficultyLevelTextSpec(
  imageHeight: number,
  playLevel: number,
) {
  return {
    maxWidth:
      imageHeight * BANGDREAM_DIFFICULTY_LIST_SPEC.badge.textMaxWidthRatio,
    text: playLevel.toString(),
    textSize: imageHeight * BANGDREAM_DIFFICULTY_LIST_SPEC.badge.textSizeRatio,
  };
}

/**
 * 计算难度等级文字居中位置。
 *
 * @param imageHeight - 难度徽章高度。
 * @param levelText - 已渲染的等级文字图片。
 */
export function getDifficultyLevelTextPosition(
  imageHeight: number,
  levelText: ImageLike,
) {
  return {
    x: imageHeight / 2 - levelText.width / 2,
    y: imageHeight / 2 - levelText.height / 2,
  };
}
