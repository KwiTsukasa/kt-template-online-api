import { Canvas } from 'skia-canvas';
import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { difficultyColorList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  BANGDREAM_DIFFICULTY_LIST_SPEC,
  createDifficultyBadgeLayout,
  createDifficultyLevelTextSpec,
  getDifficultyBadgeColor,
  getDifficultyLevelTextPosition,
  getDifficultyListCanvasWidth,
  getDifficultyListItemX,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-difficulty.layout';

/**
 * 在图片布局层中绘制难度列表。
 *
 * @param song - song 输入；使用 `difficulty` 字段生成结果。
 * @param imageHeight - imageHeight 输入；驱动 `Canvas()`、`ctx.drawImage()` 的 BangDream步骤。
 * @param spacing - spacing 输入；驱动 `Canvas()`、`ctx.drawImage()` 的 BangDream步骤。
 * @returns 渲染或资源结果。
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
 * 在图片布局层中绘制难度。
 *
 * @param difficultyType - difficultyType 输入；驱动 `getDifficultyBadgeColor()` 的 BangDream步骤。
 * @param playLevel - playLevel 输入；驱动 `drawText()` 的 BangDream步骤。
 * @param imageHeight - imageHeight 输入；驱动 `Canvas()`、`createDifficultyBadgeLayout()`、`drawText()`、`getDifficultyLevelTextPosition()` 的 BangDream步骤。
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
