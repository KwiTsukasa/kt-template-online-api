import { Canvas } from 'skia-canvas';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { difficultyColorList } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import {
  BANGDREAM_DIFFICULTY_LIST_SPEC,
  createDifficultyBadgeLayout,
  createDifficultyLevelTextSpec,
  getDifficultyBadgeColor,
  getDifficultyLevelTextPosition,
  getDifficultyListCanvasWidth,
  getDifficultyListItemX,
} from './list-difficulty-spec';

/**
 * 在图片布局层中绘制难度列表。
 *
 * @param song - 歌曲参数。
 * @param imageHeight - 图片高度参数，未传入时使用默认值。
 * @param spacing - spacing参数，未传入时使用默认值。
 * @returns 渲染或资源结果。
 */
export function drawDifficultyList(
  song: Song,
  imageHeight: number = BANGDREAM_DIFFICULTY_LIST_SPEC.list
    .defaultImageHeight,
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
 * @param difficultyType - 难度类型参数。
 * @param playLevel - play等级参数。
 * @param imageHeight - 图片高度参数。
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
