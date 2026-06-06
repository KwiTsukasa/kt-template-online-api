import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/bestdori-provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';

export type EventStageDataType = 'stages' | 'rotationMusics';

export interface EventStageTypeRow {
  endAt: string;
  startAt: string;
  type: string;
}

export interface EventStageRotationMusicRow {
  endAt: string;
  musicId: string;
  startAt: string;
}

export type EventStageDataRows<T extends EventStageDataType> =
  T extends 'stages' ? EventStageTypeRow[] : EventStageRotationMusicRow[];

export class EventStageDataRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取试炼活动阶段或轮换歌曲数据。
   *
   * @param eventId - 活动 ID。
   * @param type - 试炼数据类型。
   * @param update - 是否绕过缓存。
   */
  async getFestivalData<T extends EventStageDataType>(
    eventId: number,
    type: T,
    update: boolean = true,
  ): Promise<EventStageDataRows<T>> {
    return await this.provider.getJson<EventStageDataRows<T>>(
      `/api/festival/${type}/${eventId}.json`,
      { cacheTime: update ? 0 : 1 / 0 },
    );
  }
}

export const eventStageDataRepository = new EventStageDataRepository();
