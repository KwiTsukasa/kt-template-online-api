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
 * 按`difficultyCount`、`imageHeight`、`spacing`读取难度列表画布宽度。
 * @param difficultyCount - 限制难度列表画布宽度数量、尺寸、等级或重试边界的数值。
 * @param imageHeight - 决定难度列表画布宽度内容、边界或目标的 `imageHeight` 值。
 * @param spacing - 决定难度列表画布宽度内容、边界或目标的 `spacing` 值。
 * @returns 难度列表画布宽度。
 */
export function getDifficultyListCanvasWidth(
  difficultyCount: number,
  imageHeight: number,
  spacing: number,
) {
  return imageHeight * difficultyCount + (difficultyCount - 1) * spacing;
}

/**
 * 按`index`、`imageHeight`、`spacing`读取难度徽章在列表中的横向位置。
 * @param index - 指定难度徽章在列表中的横向位置在集合或布局中的零基位置。
 * @param imageHeight - 决定难度徽章在列表中的横向位置内容、边界或目标的 `imageHeight` 值。
 * @param spacing - 决定难度徽章在列表中的横向位置内容、边界或目标的 `spacing` 值。
 * @returns 难度徽章在列表中的横向位置。
 */
export function getDifficultyListItemX(
  index: number,
  imageHeight: number,
  spacing: number,
) {
  return index * (imageHeight + spacing);
}

/**
 * 根据参数 `difficultyType`，获取难度徽章颜色。
 * @param difficultyType - 决定根据参数 `difficultyType`，获取难度徽章颜色内容、边界或目标的 `difficultyType` 值。
 * @param colors - 用于根据参数 `difficultyType`，获取难度徽章颜色的领域对象，包含 `difficultyType` 字段。
 * @returns 规范化后的根据参数 `difficultyType`，获取难度徽章颜色；主值为空时采用 `BANGDREAM_DIFFICULTY_LIST_SPEC.badge.fallbackColor` 兜底。
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
 * 计算难度徽章圆形布局，并输出固定投影 `arcEnd`、`arcRadius`、`arcStart`、`arcX`、`arcY` 字段。
 * @param imageHeight - 决定难度Badge布局内容、边界或目标的 `imageHeight` 值。
 * @returns 包含 `arcEnd`、`arcRadius`、`arcStart`、`arcX`、`arcY` 字段的难度Badge布局。
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
 * 根据`imageHeight`、`playLevel`构造难度等级文字绘制参数。
 * @param imageHeight - 决定难度等级文字绘制参数内容、边界或目标的 `imageHeight` 值。
 * @param playLevel - 限制难度等级文字绘制参数数量、尺寸、等级或重试边界的数值。
 * @returns 包含 `maxWidth`、`text`、`textSize` 字段的难度等级文字绘制参数。
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
 * 计算难度等级文字居中位置，并输出固定投影 `x`、`y` 字段。
 * @param imageHeight - 决定难度Level文本Position内容、边界或目标的 `imageHeight` 值。
 * @param levelText - 用于难度Level文本Position的领域对象，包含 `width`、`height` 字段。
 * @returns 包含 `x`、`y` 字段的难度Level文本Position。
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
