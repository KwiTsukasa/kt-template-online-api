import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  bangDreamMainDataRepository,
  type BangDreamMainDataCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/main-data.repository';

export class SongRepository {
  /**
   * 获取歌曲主数据集合。
   */
  getSource(): BangDreamMainDataCollection {
    return bangDreamMainDataRepository.getCollection('songs');
  }

  /**
   * 创建歌曲领域模型。
   *
   * @param songId - 歌曲 ID。
   */
  create(songId: number): Song {
    return new Song(songId);
  }
}

export const songRepository = new SongRepository();
