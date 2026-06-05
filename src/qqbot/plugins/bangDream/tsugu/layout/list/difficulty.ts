import { Canvas } from 'skia-canvas';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { difficultyColorList } from '@/qqbot/plugins/bangDream/tsugu/domain/song';

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
