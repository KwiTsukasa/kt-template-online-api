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
 * 根据`songId`、`difficultyId`、`displayedServerList`绘制或格式化歌曲Chart；当 `!song.isExist` 成立时返回 `['歌曲不存在']`。
 * @param songId - 用于精确定位歌曲的标识。
 * @param difficultyId - 用于精确定位难度的标识。
 * @param displayedServerList - 决定歌曲Chart内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param compress - 决定歌曲Chart内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的歌曲Chart列表；没有匹配项时为空数组。
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
