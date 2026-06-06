import { Canvas } from 'skia-canvas';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { difficultyColorList } from '@/qqbot/plugins/bangDream/tsugu/models/song';

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
  imageHeight: number = 60,
  spacing: number = 10,
): Canvas {
  const difficultyCount = Object.keys(song.difficulty).length;
  const canvas = new Canvas(
    imageHeight * difficultyCount + (difficultyCount - 1) * spacing,
    imageHeight,
  );
  const ctx = canvas.getContext('2d');
  for (const d in song.difficulty) {
    const i = parseInt(d);
    ctx.drawImage(
      drawDifficulty(i, song.difficulty[i].playLevel, imageHeight),
      i * (imageHeight + spacing),
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
  if (difficultyColorList[difficultyType] != undefined) {
    ctx.fillStyle = difficultyColorList[difficultyType];
  } else {
    ctx.fillStyle = '#f1f1f1';
  }
  ctx.arc(imageHeight / 2, imageHeight / 2, imageHeight / 2, 0, 2 * Math.PI);
  ctx.fill();
  const levelText = drawText({
    textSize: (imageHeight / 3) * 2,
    text: playLevel.toString(),
    maxWidth: imageHeight * 3,
  });
  ctx.drawImage(
    levelText,
    imageHeight / 2 - levelText.width / 2,
    imageHeight / 2 - levelText.height / 2,
  );
  return tempCanvas;
}
