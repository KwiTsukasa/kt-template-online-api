import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class CardRepository {
  /**
   * 从仓库缓存返回卡牌主数据集合。
   * @returns 返回获取卡牌主数据集合；通过 `bangdreamCatalogRepository.getCollection` 查询匹配的持久化记录。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('cards');
  }

  /**
   * 根据`cardId`构造`create` 对应结果。
   * @param cardId - 用于精确定位卡牌的标识。
   * @returns 完成初始化并携带当前边界配置的`create` 对应。
   */
  create(cardId: number): Card {
    return new Card(cardId);
  }
}

export const cardRepository = new CardRepository();
