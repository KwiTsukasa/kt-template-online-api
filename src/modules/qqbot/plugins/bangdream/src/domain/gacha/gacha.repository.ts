import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class GachaRepository {
  /**
   * 获取卡池主数据集合。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('gacha');
  }

  /**
   * 创建卡池领域模型。
   *
   * @param gachaId - 卡池 ID；定位本次读取、更新、删除或关联的卡池。
   */
  create(gachaId: number): Gacha {
    return new Gacha(gachaId);
  }
}

export const gachaRepository = new GachaRepository();
