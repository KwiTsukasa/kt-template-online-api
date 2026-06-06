import { Canvas } from 'skia-canvas';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { drawDifficultyList, drawDifficulty } from './list-difficulty';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { drawList } from './list-frame';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/tsugu/canvas/dotted-line';
import { createHorizontalSeparatorSpec } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/layout-spec';
import {
  BANGDREAM_SONG_LIST_SPEC,
  createSongInListLayout,
  getSongListCanvasHeight,
  getSongListContentWidth,
  getSongListFrameLineHeight,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-song-spec';

/**
 * 在图片布局层中绘制歌曲In列表。
 *
 * @param song - 歌曲参数。
 * @param difficulty - 难度参数，未传入时使用默认值。
 * @param text - 待绘制文本，未传入时使用默认值。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawSongInList(
  song: Song,
  difficulty?: number,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const server = getServerByPriority(song.publishedAt, displayedServerList);
  const songImage = resizeImage({
    image: await song.getSongJacketImage(),
    widthMax: BANGDREAM_SONG_LIST_SPEC.item.jacketSourceWidthMax,
    heightMax: BANGDREAM_SONG_LIST_SPEC.item.jacketSourceHeightMax,
  });

  const difficultyImage =
    difficulty == undefined
      ? drawDifficultyList(
          song,
          BANGDREAM_SONG_LIST_SPEC.item.difficultyHeight,
          BANGDREAM_SONG_LIST_SPEC.item.difficultySpacing,
        )
      : drawDifficulty(
          difficulty,
          song.difficulty[difficulty].playLevel,
          BANGDREAM_SONG_LIST_SPEC.item.difficultyHeight,
        );
  const layout = createSongInListLayout(difficultyImage);
  const canvas = new Canvas(layout.canvasWidth, layout.canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    songImage,
    layout.jacketX,
    layout.jacketY,
    layout.jacketWidth,
    layout.jacketHeight,
  );
  //id
  const idImage = drawText({
    text: song.songId.toString(),
    textSize: layout.textSize,
    lineHeight: layout.textLineHeight,
    maxWidth: layout.textMaxWidth,
  });
  ctx.drawImage(idImage, layout.idTextX, layout.idTextY);
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
    textSize: layout.textSize,
    lineHeight: layout.textLineHeight,
    maxWidth: layout.textMaxWidth,
  });
  ctx.drawImage(textImage, layout.titleTextX, layout.titleTextY);

  ctx.drawImage(difficultyImage, layout.difficultyX, layout.difficultyY);
  return canvas;
}

/**
 * 在图片布局层中绘制歌曲列表In列表。
 *
 * @param songs - 歌曲列表参数。
 * @param difficulty - 难度参数，未传入时使用默认值。
 * @param text - 待绘制文本，未传入时使用默认值。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawSongListInList(
  songs: Song[],
  difficulty?: number,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const contentWidth = getSongListContentWidth();
  const height = getSongListCanvasHeight(songs.length);
  const canvas = new Canvas(contentWidth, height);
  const ctx = canvas.getContext('2d');
  const x = 0;
  let y = 0;
  const views: Canvas[] = [];
  const line = drawDottedLine(
    createHorizontalSeparatorSpec({
      height: BANGDREAM_SONG_LIST_SPEC.list.separatorHeight,
    }),
  );
  for (let i = 0; i < songs.length; i++) {
    views.push(
      resizeImage({
        image: await drawSongInList(
          songs[i],
          difficulty,
          text,
          displayedServerList,
        ),
        widthMax: contentWidth,
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
    key: BANGDREAM_SONG_LIST_SPEC.list.key,
    content: [canvas],
    textSize: canvas.height,
    lineHeight: getSongListFrameLineHeight(canvas.height),
    spacing: BANGDREAM_SONG_LIST_SPEC.list.spacing,
  });
}
