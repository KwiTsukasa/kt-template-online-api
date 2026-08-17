import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  bangdreamCatalogRepository,
  type BangDreamCatalogCollection,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';

export class EventRepository {
  /**
   * 从仓库缓存返回活动主数据集合。
   * @returns 返回获取活动主数据集合；通过 `bangdreamCatalogRepository.getCollection` 查询匹配的持久化记录。
   */
  getSource(): BangDreamCatalogCollection {
    return bangdreamCatalogRepository.getCollection('events');
  }

  /**
   * 从 BangDream 活动目录读取全部数值型活动 ID。
   * @returns 返回获取活动 ID 列表；通过 `bangdreamCatalogRepository.getNumericIds` 查询匹配的持久化记录。
   */
  getEventIds(): number[] {
    return bangdreamCatalogRepository.getNumericIds('events');
  }

  /**
   * 根据`eventId`构造`create` 对应结果。
   * @param eventId - 用于精确定位事件的标识。
   * @returns 完成初始化并携带当前边界配置的`create` 对应。
   */
  create(eventId: number): Event {
    return new Event(eventId);
  }
}

export const eventRepository = new EventRepository();
