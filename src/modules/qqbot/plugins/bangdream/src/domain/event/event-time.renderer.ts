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
  return formatBangDreamTime(timeStamp);
}

/**
 * 在图片布局层中格式化MonthDay。
 *
 * @param timeStamp - 时间Stamp参数。
 */
export function formatMonthDay(timeStamp: number | null) {
  return formatBangDreamMonthDay(timeStamp);
}

/**
 * 在图片布局层中格式化时间Period。
 *
 * @param period - period参数。
 * @returns 格式化后的文本。
 */
export function formatTimePeriod(period: number): string {
  return formatBangDreamPeriod(period);
}

//时间长度转时分秒函数
/**
 * 在图片布局层中格式化Seconds。
 *
 * @param value - 当前处理的值。
 */
export function formatSeconds(value: number) {
  return formatBangDreamSeconds(value);
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
