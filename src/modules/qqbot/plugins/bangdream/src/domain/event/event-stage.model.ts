import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  BANGDREAM_EVENT_STAGE_TYPES,
  BangDreamEventStageType,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import { BANGDREAM_EVENT_STAGE_NAME } from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/default-dictionary';
import { BANGDREAM_EVENT_STAGE_STROKE_COLOR } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  eventStageDataRepository,
  type EventStageDataRows,
  type EventStageRotationMusicRow,
  type EventStageTypeRow,
  type EventStageDataType,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage-data.repository';

export interface Stage {
  type: string;
  startAt: number;
  endAt: number;
  songIdList: Array<number>;
}

export const stageTypeList: string[] = [...BANGDREAM_EVENT_STAGE_TYPES];

export const stageTypeTextStrokeColor: Record<string, string> =
  BANGDREAM_EVENT_STAGE_STROKE_COLOR;

export const stageTypeName: Record<string, string> = BANGDREAM_EVENT_STAGE_NAME;

export class EventStage {
  eventId: number;
  isExist: boolean = false;
  isInitFull = false;
  stageType: EventStageTypeRow[] = [];
  rotationMusics: EventStageRotationMusicRow[] = [];
  constructor(eventId: number) {
    this.eventId = eventId;
    const event = new Event(eventId);
    if (!event.isExist) {
      this.isExist = false;
      return;
    }
    if (event.eventType != 'festival') {
      this.isExist = false;
      return;
    }
    this.isExist = true;
  }
  /**
   * 根据当前运行态处理initFull；当 `!this.isExist` 成立时直接结束且不产生返回值。
   */
  async initFull() {
    if (!this.isExist) {
      return;
    }
    if (this.isInitFull) {
      return;
    }
    try {
      const [stageData, rotationMusicsData] = await Promise.all([
        this.getData(true, 'stages'),
        this.getData(true, 'rotationMusics'),
      ]);
      this.stageType = stageData;
      this.rotationMusics = rotationMusicsData;
      this.isInitFull = true;
    } catch {
      this.isExist = false;
    }
  }
  /**
   * 在 EventStage 模型中请求当前模型的远端详情数据。
   * @param update - 决定在 EventStage 模型中请求当前模型的远端详情数据内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @param type - 决定在 EventStage 模型中请求当前模型的远端详情数据内容、边界或目标的 `type` 值。
   * @returns 在 EventStage 模型中请求当前模型的远端详情数据。
   */
  async getData<T extends EventStageDataType>(
    update: boolean = true,
    type: T,
  ): Promise<EventStageDataRows<T>> {
    return await eventStageDataRepository.getFestivalData(
      this.eventId,
      type,
      update,
    );
  }

  /**
   * 按当前运行态读取阶段；当 `!this.isInitFull` 成立时返回 `[]`。
   * @returns 按输入顺序得到的阶段列表；没有匹配项时为空数组。
   */
  getStageList(): Stage[] {
    if (!this.isInitFull) {
      return [];
    }
    const groupedByStartAt: Record<
      string,
      { startAt: string; endAt: string; music: number[] }
    > = {};
    for (const rotationMusic of this.rotationMusics) {
      const tempStartAt = rotationMusic.startAt;
      if (groupedByStartAt[tempStartAt] == undefined) {
        groupedByStartAt[tempStartAt] = {
          startAt: rotationMusic.startAt,
          endAt: rotationMusic.endAt,
          music: [],
        };
      }
      groupedByStartAt[tempStartAt].music.push(Number(rotationMusic.musicId));
    }
    const tempStageList: Stage[] = [];
    for (const element of Object.values(groupedByStartAt)) {
      const tempStartAt = parseInt(element.startAt);
      const tempEndAt = parseInt(element.endAt);
      const tempStageType = this.getStageTypeByTime(tempStartAt, tempEndAt);
      tempStageList.push({
        type: tempStageType,
        startAt: tempStartAt,
        endAt: tempEndAt,
        songIdList: element.music,
      });
    }
    tempStageList.sort((a, b) => {
      return a.startAt - b.startAt;
    });

    return tempStageList;
  }

  /**
   * 按`startAt`、`endAt`读取阶段Type时间；当 `!this.isInitFull` 成立时返回 `BangDreamEventStageType.unknown`。
   * @param startAt - 用于过期、排序或租约判定的时间基准。
   * @param endAt - 用于过期、排序或租约判定的时间基准。
   * @returns 规范化后的阶段Type时间；主值为空时采用 `BangDreamEventStageType.unknown` 兜底。
   */
  getStageTypeByTime(startAt: number, endAt: number): string {
    if (!this.isInitFull) {
      return BangDreamEventStageType.unknown;
    }
    const stage = this.stageType.find((x) => {
      const startTime = parseInt(x.startAt);
      const endTime = parseInt(x.endAt);
      if (startTime <= endAt && endTime >= startAt) {
        return true;
      }
      return false;
    });
    return stage?.type || BangDreamEventStageType.unknown;
  }
}
