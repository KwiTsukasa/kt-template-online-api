import {
  Song,
  difficultyName,
} from '@/qqbot/plugins/bangDream/tsugu/domain/song';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/domain/band';
import { drawBestdoriPreview } from '@/qqbot/plugins/bangDream/tsugu/layout/bestdori-preview';
import { getServerByPriority } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

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
