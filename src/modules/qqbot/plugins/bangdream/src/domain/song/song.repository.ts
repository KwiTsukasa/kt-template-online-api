import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class SongRepository {
  /**
   * 获取歌曲主数据集合。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('songs');
  }

  /**
   * 创建歌曲领域模型。
   *
   * @param songId - 歌曲 ID；定位本次读取、更新、删除或关联的歌曲。
   */
  create(songId: number): Song {
    return new Song(songId);
  }
}

export const songRepository = new SongRepository();
