import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class CardRepository {
  /**
   * 获取卡牌主数据集合。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('cards');
  }

  /**
   * 创建卡牌领域模型。
   *
   * @param cardId - 卡牌 ID。
   */
  create(cardId: number): Card {
    return new Card(cardId);
  }
}

export const cardRepository = new CardRepository();
