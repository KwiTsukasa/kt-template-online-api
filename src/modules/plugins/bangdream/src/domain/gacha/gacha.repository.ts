import { Gacha } from '@/modules/plugins/bangdream/src/domain/gacha/gacha.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class GachaRepository {
  /**
   * 从仓库缓存返回卡池主数据集合。
   * @returns 返回获取卡池主数据集合；通过 `bangdreamCatalogRepository.getCollection` 查询匹配的持久化记录。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('gacha');
  }

  /**
   * 根据`gachaId`构造`create` 对应结果。
   * @param gachaId - 用于精确定位卡池的标识。
   * @returns 完成初始化并携带当前边界配置的`create` 对应。
   */
  create(gachaId: number): Gacha {
    return new Gacha(gachaId);
  }
}

export const gachaRepository = new GachaRepository();
