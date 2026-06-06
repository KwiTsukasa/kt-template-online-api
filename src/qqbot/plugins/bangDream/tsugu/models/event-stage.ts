import { Event } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import {
  BANGDREAM_EVENT_STAGE_NAME,
  BANGDREAM_EVENT_STAGE_STROKE_COLOR,
  BANGDREAM_EVENT_STAGE_TYPES,
  BangDreamEventStageType,
} from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';
import {
  eventStageDataRepository,
  type EventStageDataType,
} from '@/qqbot/plugins/bangDream/tsugu/models/event-stage-data-repository';

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
  stageType: Array<{ type: string; startAt: string; endAt: string }>;
  rotationMusics: Array<{ musicId: string; startAt: string; endAt: string }>;
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
      const stageData = await this.getData(true, 'stages');
      const rotationMusicsData = await this.getData(true, 'rotationMusics');
      this.stageType = stageData as any;
      this.rotationMusics = rotationMusicsData as any;
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
  async getData(update: boolean = true, type: EventStageDataType) {
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
    //获取所有的stage,并且按照时间排序 [{type,startAt,endAt,songIdList}]
    if (!this.isInitFull) {
      return;
    }
    const temp = {};
    for (const i in this.rotationMusics) {
      const tempStartAt = this.rotationMusics[i].startAt;
      if (temp[tempStartAt] == undefined) {
        temp[tempStartAt] = {
          startAt: this.rotationMusics[i].startAt,
          endAt: this.rotationMusics[i].endAt,
          music: [],
        };
      }
      temp[tempStartAt].music.push(this.rotationMusics[i].musicId);
    }
    const tempStageList: Stage[] = [];
    for (const i in temp) {
      const element = temp[i];
      const tempStartAt = parseInt(element.startAt);
      const tempEndAt = parseInt(element.endAt);
      const tempStageType = this.getStageTypeByTime(tempStartAt, tempEndAt);
      tempStageList.push({
        type: tempStageType,
        startAt: tempStartAt,
        endAt: tempEndAt,
        songIdList: temp[i].music,
      });
    }
    //排序
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
    //根据时间获取当前stage类型
    if (!this.isInitFull) {
      return;
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
