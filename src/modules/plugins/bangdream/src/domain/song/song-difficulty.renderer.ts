import { Canvas } from 'skia-canvas';
import { Song } from '@/modules/plugins/bangdream/src/domain/song/song.model';
import { drawText } from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { difficultyColorList } from '@/modules/plugins/bangdream/src/domain/song/song.model';
import {
  BANGDREAM_DIFFICULTY_LIST_SPEC,
  createDifficultyBadgeLayout,
  createDifficultyLevelTextSpec,
  getDifficultyBadgeColor,
  getDifficultyLevelTextPosition,
  getDifficultyListCanvasWidth,
  getDifficultyListItemX,
} from '@/modules/plugins/bangdream/src/domain/song/song-difficulty.layout';

/**
 * 根据`song`、`imageHeight`、`spacing`绘制或格式化难度；把图片、文本或图形按布局规格绘制到画布。
 * @param song - 用于难度的领域对象，包含 `difficulty` 字段。
 * @param imageHeight - 决定难度内容、边界或目标的 `imageHeight` 值；省略时默认采用 `BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultImageH…`。
 * @param spacing - 决定难度内容、边界或目标的 `spacing` 值；省略时默认采用 `BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultSpacing`。
 * @returns 难度。
 */
export function drawDifficultyList(
  song: Song,
  imageHeight: number = BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultImageHeight,
  spacing: number = BANGDREAM_DIFFICULTY_LIST_SPEC.list.defaultSpacing,
): Canvas {
  const difficultyCount = Object.keys(song.difficulty).length;
  const canvas = new Canvas(
    getDifficultyListCanvasWidth(difficultyCount, imageHeight, spacing),
    imageHeight,
  );
  const ctx = canvas.getContext('2d');
  for (const d in song.difficulty) {
    const i = parseInt(d);
    ctx.drawImage(
      drawDifficulty(i, song.difficulty[i].playLevel, imageHeight),
      getDifficultyListItemX(i, imageHeight, spacing),
      0,
    );
  }
  return canvas;
}

/**
 * 根据`difficultyType`、`playLevel`、`imageHeight`绘制或格式化难度；把图片、文本或图形按布局规格绘制到画布。
 * @param difficultyType - 决定难度内容、边界或目标的 `difficultyType` 值。
 * @param playLevel - 限制难度数量、尺寸、等级或重试边界的数值。
 * @param imageHeight - 决定难度内容、边界或目标的 `imageHeight` 值。
 * @returns 难度。
 */
export function drawDifficulty(
  difficultyType: number,
  playLevel: number,
  imageHeight: number,
) {
  const tempCanvas = new Canvas(imageHeight, imageHeight);
  const ctx = tempCanvas.getContext('2d');
  const badgeLayout = createDifficultyBadgeLayout(imageHeight);
  ctx.fillStyle = getDifficultyBadgeColor(difficultyType, difficultyColorList);
  ctx.arc(
    badgeLayout.arcX,
    badgeLayout.arcY,
    badgeLayout.arcRadius,
    badgeLayout.arcStart,
    badgeLayout.arcEnd,
  );
  ctx.fill();
  const levelText = drawText(
    createDifficultyLevelTextSpec(imageHeight, playLevel),
  );
  const position = getDifficultyLevelTextPosition(imageHeight, levelText);
  ctx.drawImage(levelText, position.x, position.y);
  return tempCanvas;
}
