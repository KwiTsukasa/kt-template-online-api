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
  /**
   * 初始化 EventStageDataRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取试炼活动阶段或轮换歌曲数据。
   *
   * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
   * @param type - type 输入；限定 BangDream查询范围。
   * @param update - update 输入；限定 BangDream查询范围。
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
