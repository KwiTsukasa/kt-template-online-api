import { Gacha } from './gacha';
import {
  bangDreamMainDataRepository,
  type BangDreamMainDataCollection,
} from './main-data-repository';

export class GachaRepository {
  /**
   * 获取卡池主数据集合。
   */
  getSource(): BangDreamMainDataCollection {
    return bangDreamMainDataRepository.getCollection('gacha');
  }

  /**
   * 创建卡池领域模型。
   *
   * @param gachaId - 卡池 ID。
   */
  create(gachaId: number): Gacha {
    return new Gacha(gachaId);
  }
}

export const gachaRepository = new GachaRepository();
