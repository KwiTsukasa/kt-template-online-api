import { Canvas } from 'skia-canvas';
import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { resizeImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import {
  drawDifficultyList,
  drawDifficulty,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-difficulty.renderer';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawDottedLine } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-dotted-line';
import { createHorizontalSeparatorSpec } from '@/modules/qqbot/plugins/bangdream/src/theme/layout';
import {
  BANGDREAM_SONG_LIST_SPEC,
  createSongInListLayout,
  getSongListCanvasHeight,
  getSongListContentWidth,
  getSongListFrameLineHeight,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.layout';

/**
 * 根据`song`、`difficulty`、`text`绘制或格式化歌曲；把图片、文本或图形按布局规格绘制到画布。
 * @param song - 用于歌曲的领域对象，包含 `publishedAt`、`getSongJacketImage`、`difficulty`、`songId` 字段。
 * @param difficulty - 决定歌曲内容、边界或目标的 `difficulty` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param text - 决定歌曲内容、边界或目标的 `text` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param displayedServerList - 决定歌曲内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 歌曲。
 */
export async function drawSongInList(
  song: Song,
  difficulty?: number,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const server = getServerByPriority(song.publishedAt, displayedServerList);
  const songImage = resizeImage({
    image: await song.getSongJacketImage(displayedServerList),
    widthMax: BANGDREAM_SONG_LIST_SPEC.item.jacketSourceWidthMax,
    heightMax: BANGDREAM_SONG_LIST_SPEC.item.jacketSourceHeightMax,
  });

  const difficultyImage =
    (() => {
      if (difficulty == undefined) {
        return drawDifficultyList(
          song,
          BANGDREAM_SONG_LIST_SPEC.item.difficultyHeight,
          BANGDREAM_SONG_LIST_SPEC.item.difficultySpacing,
        );
      }
      return drawDifficulty(
          difficulty,
          song.difficulty[difficulty].playLevel,
          BANGDREAM_SONG_LIST_SPEC.item.difficultyHeight,
        );
    })();
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
 * 根据`songs`、`difficulty`、`text`绘制或格式化歌曲；把图片、文本或图形按布局规格绘制到画布。
 * @param songs - 用于歌曲的领域对象，包含 `length`、`i` 字段。
 * @param difficulty - 决定歌曲内容、边界或目标的 `difficulty` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param text - 决定歌曲内容、边界或目标的 `text` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param displayedServerList - 决定歌曲内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 歌曲。
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
