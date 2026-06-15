import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class EventRepository {
  /**
   * 获取活动主数据集合。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('events');
  }

  /**
   * 获取活动 ID 列表。
   */
  getEventIds(): number[] {
    return bangdreamCatalogRepository.getNumericIds('events');
  }

  /**
   * 创建活动领域模型。
   *
   * @param eventId - 活动 ID。
   */
  create(eventId: number): Event {
    return new Event(eventId);
  }
}

export const eventRepository = new EventRepository();
