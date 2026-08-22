import { Song } from '@/modules/plugins/bangdream/src/domain/song/song.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class SongRepository {
  /**
   * 从仓库缓存返回歌曲主数据集合。
   * @returns 返回获取歌曲主数据集合；通过 `bangdreamCatalogRepository.getCollection` 查询匹配的持久化记录。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('songs');
  }

  /**
   * 根据`songId`构造`create` 对应结果。
   * @param songId - 用于精确定位歌曲的标识。
   * @returns 完成初始化并携带当前边界配置的`create` 对应。
   */
  create(songId: number): Song {
    return new Song(songId);
  }
}

export const songRepository = new SongRepository();
