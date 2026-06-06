import { Event } from '@/qqbot/plugins/bangDream/event/event.model';
import {
  bangDreamMainDataRepository,
  type BangDreamMainDataCollection,
} from '@/qqbot/plugins/bangDream/shared/main-data.repository';

export class EventRepository {
  /**
   * 获取活动主数据集合。
   */
  getSource(): BangDreamMainDataCollection {
    return bangDreamMainDataRepository.getCollection('events');
  }

  /**
   * 获取活动 ID 列表。
   */
  getEventIds(): number[] {
    return bangDreamMainDataRepository.getNumericIds('events');
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
