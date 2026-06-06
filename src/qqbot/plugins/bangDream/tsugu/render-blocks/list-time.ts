import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { getPresentEvent } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import {
  Server,
  getServerByName,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawListByServerList } from './list-frame';
import { Canvas } from 'skia-canvas';
import {
  estimateCnEventStartAt,
  type BangDreamEventTimeLike,
} from '@/qqbot/plugins/bangDream/tsugu/models/cn-event-estimate-policy';
import {
  getBangDreamDateByServerTimezone,
  getBangDreamServerUtcOffset,
  normalizeBangDreamTimestamp,
} from '@/qqbot/plugins/bangDream/tsugu/models/server-policy';

interface TimeInListOptions {
  key?: string;
  content: Array<number | null>;
  eventId?: number;
  estimateCNTime?: boolean;
}
/**
 * 在图片布局层中绘制时间In列表。
 *
 * @param options1 - options1参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawTimeInList(
  { key, content, eventId, estimateCNTime = false }: TimeInListOptions,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const formattedTimeList: Array<string> = [];
  for (let i = 0; i < content.length; i++) {
    const element = content[i];
    if (element == null) {
      if (i == 3 && estimateCNTime && eventId != null) {
        const currentEvent = getPresentEvent(getServerByName('cn'));
        const currentEventId = currentEvent?.eventId;
        const estimatedStartAt = getProbableTimeDifference(
          eventId,
          currentEvent,
        );
        if (currentEventId != null && eventId > currentEventId) {
          formattedTimeList.push(
            formatTime(estimatedStartAt) + ' (预计开放时间)',
          );
        }
      }
      formattedTimeList.push(null);
      continue;
    }
    formattedTimeList.push(formatTime(element));
  }
  const canvas = await drawListByServerList(
    formattedTimeList,
    key,
    displayedServerList,
  );
  return canvas;
}
//获取当前活动与查询活动的大致时间差(国服)
//注: 返回的并非时间差，而是活动预计开始的时间戳
/**
 * 在图片布局层中获取Probable时间Difference。
 *
 * @param eventId - 活动 ID。
 * @param currentEvent - current活动参数。
 * @returns 计算后的数值。
 */
export function getProbableTimeDifference(
  eventId: number,
  currentEvent: BangDreamEventTimeLike | null,
): number | null {
  return estimateCnEventStartAt(eventId, currentEvent);
}

/**
 * 在图片布局层中格式化时间。
 *
 * @param timeStamp - 时间Stamp参数。
 */
export function formatTime(timeStamp: number | null) {
  //时间戳到年月日 精确到分钟
  if (timeStamp == null) {
    return '?';
  }
  const date = new Date(Math.floor(timeStamp / 1000) * 1000);
  let nMinutes: string;
  if (date.getMinutes() < 10) {
    nMinutes = '0' + date.getMinutes().toString();
    if (date.getMinutes() == 0) {
      nMinutes = '00';
    }
  } else {
    nMinutes = date.getMinutes().toString();
  }
  const temp =
    date.getFullYear().toString() +
    '年' +
    (date.getMonth() + 1).toString() +
    '月' +
    date.getDate().toString() +
    '日 ' +
    date.getHours().toString() +
    ':' +
    nMinutes;
  return temp;
}

/**
 * 在图片布局层中格式化MonthDay。
 *
 * @param timeStamp - 时间Stamp参数。
 */
export function formatMonthDay(timeStamp: number | null) {
  //获取生日的月与日
  /**
   * 在图片布局层中转换为Japan时间。
   *
   * @param dateString - dateString参数。
   */
  function toJapanTime(dateString) {
    // 创建一个新的Date实例，表示当前时间。
    const date = new Date(dateString);

    // 获取本地时间与UTC的时间差（分钟）。
    const offset = date.getTimezoneOffset() * 60000;

    // 将本地时间转换为UTC时间。
    const utcTime = date.getTime() + offset;

    // 日本时区的偏移量是UTC+9。
    const japanTimeOffset = 9 * 60 * 60 * 1000;

    // 将UTC时间转换为日本时间。
    const japanTime = new Date(utcTime + japanTimeOffset);

    // 返回日本时间的字符串表示。
    return japanTime;
  }

  if (timeStamp == null) {
    return '?';
  }
  const date = toJapanTime(timeStamp);
  const temp =
    (date.getMonth() + 1).toString() + '月' + date.getDate().toString() + '日 ';
  return temp;
}

/**
 * 在图片布局层中格式化时间Period。
 *
 * @param period - period参数。
 * @returns 格式化后的文本。
 */
export function formatTimePeriod(period: number): string {
  //时间戳的差值到年月日时分秒
  if (period == null) {
    return '?';
  }

  const century = Math.floor(period / (1000 * 60 * 60 * 24 * 30 * 12 * 100));
  const years = Math.floor(period / (1000 * 60 * 60 * 24 * 30 * 12));
  const months = Math.floor(period / (1000 * 60 * 60 * 24 * 30));
  const days = Math.floor(
    (period % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24),
  );
  const hours = Math.floor((period % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((period % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((period % (1000 * 60)) / 1000);

  let temp = '';

  if (century != 0) {
    temp += century.toString() + '世纪';
  }
  if (years != 0) {
    temp += years.toString() + '年';
  }
  if (months != 0) {
    temp += months.toString() + '月';
  }
  if (days != 0) {
    temp += days.toString() + '日';
  }
  if (hours != 0) {
    temp += hours.toString() + '小时';
  }
  if (minutes != 0) {
    temp += minutes.toString() + '分钟';
  }
  temp += seconds.toString() + '秒';

  return temp;
}

//时间长度转时分秒函数
/**
 * 在图片布局层中格式化Seconds。
 *
 * @param value - 当前处理的值。
 */
export function formatSeconds(value: number) {
  let theTime = value; // 秒
  let theTime1 = 0; // 分
  let theTime2 = 0; // 小时
  if (theTime > 60) {
    theTime1 = parseInt((theTime / 60).toString());
    theTime = parseInt((theTime % 60).toString());
    if (theTime1 > 60) {
      theTime2 = parseInt((theTime1 / 60).toString());
      theTime1 = parseInt((theTime1 % 60).toString());
    }
  }
  let result = '' + parseInt(theTime.toString()) + '秒';
  if (theTime1 > 0) {
    result = '' + parseInt(theTime1.toString()) + '分' + result;
  }
  if (theTime2 > 0) {
    result = '' + parseInt(theTime2.toString()) + '小时' + result;
  }
  return result;
}

/**
 * 在图片布局层中处理occupiedDays。
 *
 * @param startTs - startTs参数。
 * @param endTs - endTs参数。
 * @returns 计算后的数值。
 */
/**
 * 在图片布局层中规范化Timestamp。
 *
 * @param time - 谱面时间点。
 * @returns 计算后的数值。
 */
export function normalizeTimestamp(time: number | string): number {
  return normalizeBangDreamTimestamp(time);
}

/**
 * 在图片布局层中获取服务器UtcOffset。
 *
 * @param server - 目标服务器。
 * @returns 计算后的数值。
 */
export function getServerUtcOffset(server: Server): number {
  return getBangDreamServerUtcOffset(server);
}

/**
 * 在图片布局层中获取DateBy服务器Timezone。
 *
 * @param time - 谱面时间点。
 * @param server - 目标服务器。
 * @returns 处理结果。
 */
export function getDateByServerTimezone(
  time: number | string,
  server: Server,
): Date {
  return getBangDreamDateByServerTimezone(time, server);
}
