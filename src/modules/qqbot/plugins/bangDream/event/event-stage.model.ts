import { Event } from '@/modules/qqbot/plugins/bangDream/event/event.model';
import {
  BANGDREAM_EVENT_STAGE_NAME,
  BANGDREAM_EVENT_STAGE_STROKE_COLOR,
  BANGDREAM_EVENT_STAGE_TYPES,
  BangDreamEventStageType,
} from '@/modules/qqbot/plugins/bangDream/shared/bangdream-constants';
import {
  eventStageDataRepository,
  type EventStageDataRows,
  type EventStageRotationMusicRow,
  type EventStageTypeRow,
  type EventStageDataType,
} from '@/modules/qqbot/plugins/bangDream/event/event-stage-data.repository';

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
  /**
   * 构造 EventStage 实例，并初始化该模型的本地基础字段。
   *
   * @param eventId - 活动 ID。
   */
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
   * 在 EventStage 模型中加载远端完整详情并标记初始化状态。
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
   *
   * @param update - update参数，未传入时使用默认值。
   * @param type - 数据类型或匹配类型。
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
   * 在 EventStage 模型中获取试炼列表。
   *
   * @returns 处理后的列表。
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
   * 在 EventStage 模型中获取试炼类型By时间。
   *
   * @param startAt - startAt参数。
   * @param endAt - endAt参数。
   * @returns 格式化后的文本。
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
