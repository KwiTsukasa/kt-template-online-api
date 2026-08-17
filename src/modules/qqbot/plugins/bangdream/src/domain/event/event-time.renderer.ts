import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  Server,
  getServerByName,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawListByServerList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas } from 'skia-canvas';
import {
  estimateCnEventStartAt,
  type BangDreamEventTimeLike,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/cn-event-estimate.policy';
import {
  getBangDreamDateByServerTimezone,
  getBangDreamServerUtcOffset,
  normalizeBangDreamTimestamp,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/server.policy';
import {
  BANGDREAM_TIME_FORMAT_SPEC,
  formatBangDreamMonthDay,
  formatBangDreamPeriod,
  formatBangDreamSeconds,
  formatBangDreamTime,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.layout';

interface TimeInListOptions {
  key?: string;
  content: Array<number | null>;
  eventId?: number;
  estimateCNTime?: boolean;
}
/**
 * 根据`displayedServerList`绘制或格式化时间；从 `getPresentEvent` 读取时间。
 * @param displayedServerList - 决定时间内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 时间。
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
            formatTime(estimatedStartAt) +
              BANGDREAM_TIME_FORMAT_SPEC.estimatedOpenSuffix,
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
 * 根据国服当前活动与目标活动编号估算目标活动开始时间；无法估算时返回空值。
 * @param eventId - 用于精确定位事件的标识。
 * @param currentEvent - 触发预计时间Difference的领域事件。
 * @returns 预计时间Difference。
 */
export function getProbableTimeDifference(
  eventId: number,
  currentEvent: BangDreamEventTimeLike | null,
): number | null {
  return estimateCnEventStartAt(eventId, currentEvent);
}

/**
 * 将活动时间戳转换为 BanG Dream 统一日期时间文本，并保留空时间的既定占位语义。
 * @param timeStamp - 决定时间内容、边界或目标的 `timeStamp` 值。
 * @returns 时间。
 */
export function formatTime(timeStamp: number | null) {
  return formatBangDreamTime(timeStamp);
}

/**
 * 将活动时间戳转换为 BanG Dream 月日文本，并保留空时间的既定占位语义。
 * @param timeStamp - 决定MonthDay内容、边界或目标的 `timeStamp` 值。
 * @returns BanG Dream 统一格式的月日文本；空时间沿用格式化器的占位结果。
 */
export function formatMonthDay(timeStamp: number | null) {
  return formatBangDreamMonthDay(timeStamp);
}

/**
 * 将`period`转换为时间区间。
 * @param period - 决定时间区间内容、边界或目标的 `period` 值。
 * @returns 时间区间。
 */
export function formatTimePeriod(period: number): string {
  return formatBangDreamPeriod(period);
}

//时间长度转时分秒函数
/**
 * 将秒数转换为 BanG Dream 统一时长文本，包含小时、分钟与秒的适用部分。
 * @param value - 待转换为秒数的原始值。
 * @returns 秒数。
 */
export function formatSeconds(value: number) {
  return formatBangDreamSeconds(value);
}

/**
 * 将数字或文本时间交给 BanG Dream 统一时间戳规范化规则，并返回毫秒值。
 * @param time - 决定Timestamp内容、边界或目标的 `time` 值。
 * @returns BanG Dream 统一规范化后的毫秒时间戳。
 */
export function normalizeTimestamp(time: number | string): number {
  return normalizeBangDreamTimestamp(time);
}

/**
 * 按`server`读取服务器UtcOffset；从 `getBangDreamServerUtcOffset` 读取服务器UtcOffset。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 服务器UtcOffset。
 */
export function getServerUtcOffset(server: Server): number {
  return getBangDreamServerUtcOffset(server);
}

/**
 * 按`time`、`server`读取日期服务器时区；从 `getBangDreamDateByServerTimezone` 读取日期服务器时区。
 * @param time - 决定日期服务器时区内容、边界或目标的 `time` 值。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 日期服务器时区。
 */
export function getDateByServerTimezone(
  time: number | string,
  server: Server,
): Date {
  return getBangDreamDateByServerTimezone(time, server);
}
