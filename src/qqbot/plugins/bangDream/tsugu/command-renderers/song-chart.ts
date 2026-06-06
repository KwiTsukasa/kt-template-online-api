import {
  Song,
  difficultyName,
} from '@/qqbot/plugins/bangDream/tsugu/models/song';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import { drawBestdoriPreview } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/song-chart-preview';
import { getServerByPriority } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';

/**
 * 在QQBot 图片视图层中绘制歌曲谱面。
 *
 * @param songId - 歌曲 ID。
 * @param difficultyId - 难度ID参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawSongChart(
  songId: number,
  difficultyId: number,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const song = new Song(songId);
  if (!song.isExist) {
    return ['歌曲不存在'];
  }
  await song.initFull();
  if (!song.difficulty[difficultyId]) {
    return ['难度不存在'];
  }
  const server = getServerByPriority(song.publishedAt, displayedServerList);
  const band = new Band(song.bandId);
  const bandName = band.bandName[server];
  const songChart = await song.getSongChart(difficultyId);

  const tempCanvas = await drawBestdoriPreview(
    {
      id: song.songId,
      title: song.musicTitle[server],
      artist: bandName,
      author: song.detail.lyricist[server],
      level: song.difficulty[difficultyId].playLevel,
      diff: difficultyName[difficultyId],
      cover: song.getSongJacketImageURL(displayedServerList),
    },
    songChart as any,
  );

  let buffer: Buffer;
  if (compress != undefined && compress) {
    buffer = tempCanvas.toBufferSync('jpeg', { quality: 0.7 });
  } else {
    buffer = tempCanvas.toBufferSync('png');
  }

  return [buffer];
}
