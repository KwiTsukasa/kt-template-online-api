import { Card } from '@/modules/qqbot/plugins/bangDream/card/card.model';
import {
  bangDreamMainDataRepository,
  type BangDreamMainDataCollection,
} from '@/modules/qqbot/plugins/bangDream/shared/main-data.repository';

export class CardRepository {
  /**
   * 获取卡牌主数据集合。
   */
  getSource(): BangDreamMainDataCollection {
    return bangDreamMainDataRepository.getCollection('cards');
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
