import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';

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
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `eventId`，获取试炼活动阶段或轮换歌曲数据。
   * @param eventId - 用于精确定位事件的标识。
   * @param type - 决定根据参数 `eventId`，获取试炼活动阶段或轮换歌曲数据内容、边界或目标的 `type` 值。
   * @param update - 决定根据参数 `eventId`，获取试炼活动阶段或轮换歌曲数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 根据参数 `eventId`，获取试炼活动阶段或轮换歌曲数据。
   */
  async getFestivalData<T extends EventStageDataType>(
    eventId: number,
    type: T,
    update: boolean = true,
  ): Promise<EventStageDataRows<T>> {
    return await this.provider.getJson<EventStageDataRows<T>>(
      `/api/festival/${type}/${eventId}.json`,
      { cacheTime: (() => {
        if (update) {
          return 0;
        }
        return 1 / 0;
      })() },
    );
  }
}

export const eventStageDataRepository = new EventStageDataRepository();
