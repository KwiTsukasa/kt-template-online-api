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
 * @param difficultyCount - difficultyCount 输入；限定 BangDream查询范围。
 * @param imageHeight - imageHeight 输入；限定 BangDream查询范围。
 * @param spacing - spacing 输入；限定 BangDream查询范围。
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
 * @param index - index 输入；限定 BangDream查询范围。
 * @param imageHeight - imageHeight 输入；限定 BangDream查询范围。
 * @param spacing - spacing 输入；限定 BangDream查询范围。
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
 * @param difficultyType - difficultyType 输入；限定 BangDream查询范围。
 * @param colors - BangDream列表；限定 BangDream查询范围。
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
 * @param imageHeight - imageHeight 输入；生成 BangDream对象。
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
 * @param imageHeight - imageHeight 输入；驱动 `playLevel.toString()` 的 BangDream步骤。
 * @param playLevel - playLevel 输入；生成规范化文本。
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
 * @param imageHeight - imageHeight 输入；限定 BangDream查询范围。
 * @param levelText - levelText 输入；使用 `width`、`height` 字段生成结果。
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
