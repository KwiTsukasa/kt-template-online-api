import { Canvas } from 'skia-canvas';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/domain/band';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { drawDifficultyList, drawDifficulty } from './difficulty';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawList } from '../list';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/graphics/dotted-line';

export async function drawSongInList(
  song: Song,
  difficulty?: number,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const server = getServerByPriority(song.publishedAt, displayedServerList);
  const songImage = resizeImage({
    image: await song.getSongJacketImage(),
    widthMax: 80,
    heightMax: 80,
  });

  const canvas = new Canvas(800, 75);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(songImage, 50, 5, 65, 65);
  //id
  const idImage = drawText({
    text: song.songId.toString(),
    textSize: 23,
    lineHeight: 37.5,
    maxWidth: 800,
  });
  ctx.drawImage(idImage, 0, 0);
  //曲名与乐队名
  let fullText = `${song.musicTitle[server]}`;
  if (!text) {
    //如果没有传入text参数，使用乐队名
    fullText += `\n${new Band(song.bandId).bandName[server]}`;
  } else {
    //如果传入了text参数，使用text参数代替乐队名
    fullText += `\n${text}`;
  }
  const textImage = drawText({
    text: fullText,
    textSize: 23,
    lineHeight: 37.5,
    maxWidth: 800,
  });
  ctx.drawImage(textImage, 120, 0);

  //难度
  const difficultyImage =
    difficulty == undefined
      ? drawDifficultyList(song, 45, 10)
      : drawDifficulty(difficulty, song.difficulty[difficulty].playLevel, 45);
  ctx.drawImage(
    difficultyImage,
    800 - difficultyImage.width,
    75 / 2 - difficultyImage.height / 2,
  );
  return canvas;
}

export async function drawSongListInList(
  songs: Song[],
  difficulty?: number,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const height: number = 75 * songs.length + 10 * (songs.length - 1);
  const canvas = new Canvas(760, height);
  const ctx = canvas.getContext('2d');
  const x = 0;
  let y = 0;
  const views: Canvas[] = [];
  const line = drawDottedLine({
    width: 800,
    height: 10,
    startX: 5,
    startY: 5,
    endX: 795,
    endY: 5,
    radius: 2,
    gap: 10,
    color: '#a8a8a8',
  });
  for (let i = 0; i < songs.length; i++) {
    views.push(
      resizeImage({
        image: await drawSongInList(
          songs[i],
          difficulty,
          text,
          displayedServerList,
        ),
        widthMax: 760,
      }),
    );
    views.push(line);
  }
  views.pop();
  for (let i = 0; i < views.length; i++) {
    ctx.drawImage(views[i], x, y);
    y += views[i].height;
  }
  return await drawList({
    key: '歌榜歌曲',
    content: [canvas],
    textSize: canvas.height,
    lineHeight: canvas.height + 20,
    spacing: 0,
  });
}
