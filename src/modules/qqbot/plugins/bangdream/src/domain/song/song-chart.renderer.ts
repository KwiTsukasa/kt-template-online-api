import {
  Song,
  difficultyName,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { Band } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/band.model';
import { drawBestdoriPreview } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart-preview.renderer';
import { getServerByPriority } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';

/**
 * 在QQBot 图片视图层中绘制歌曲谱面。
 *
 * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
 * @param difficultyId - BangDream ID；定位本次读取、更新、删除或关联的BangDream。
 * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()`、`song.getSongJacketImageURL()` 的 BangDream步骤。
 * @param compress - BangDream列表；决定 BangDream条件分支。
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
    songChart,
  );

  let buffer: Buffer;
  if (compress != undefined && compress) {
    buffer = tempCanvas.toBufferSync('jpeg', { quality: 0.7 });
  } else {
    buffer = tempCanvas.toBufferSync('png');
  }

  return [buffer];
}
