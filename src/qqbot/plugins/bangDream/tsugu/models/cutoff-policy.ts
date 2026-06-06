import {
  BangDreamEventStatus,
  BangDreamServerId as Server,
} from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-protocol';
import {
  estimateCnEventStartAt,
  type BangDreamEventTimeLike,
} from '@/qqbot/plugins/bangDream/tsugu/models/cn-event-estimate-policy';
import {
  getBangDreamDateByServerTimezone,
  getBangDreamServerUtcOffset,
  isBangDreamDailyCheckpoint,
  normalizeBangDreamTimestamp,
} from '@/qqbot/plugins/bangDream/tsugu/models/server-policy';
import { BANGDREAM_TIER_LIST_BY_SERVER } from '@/qqbot/plugins/bangDream/tsugu/runtime/runtime-options';

const FIRST_DAY_END_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CutoffEventScheduleInput {
  currentEvent?: BangDreamEventTimeLike | null;
  endAt: Array<number | null>;
  eventId: number;
  server: number;
  startAt: Array<number | null>;
}

export interface CutoffRecentEventCandidate {
  eventId: number;
  eventType: string;
  startAt: Array<number | null>;
}

export interface CutoffRecentEventSelectionOptions {
  candidates: CutoffRecentEventCandidate[];
  count: number;
  event: CutoffRecentEventCandidate;
  sameType?: boolean;
  server: number;
}

/**
 * 获取指定服务器支持的档位列表。
 *
 * @param server - 目标服务器。
 * @returns 档位列表。
 */
export function getCutoffTierList(server: number): readonly number[] {
  return BANGDREAM_TIER_LIST_BY_SERVER[Server[server]] ?? [];
}

/**
 * 判断服务器是否支持指定档位。
 *
 * @param server - 目标服务器。
 * @param tier - 目标档位。
 * @returns 是否支持。
 */
export function isCutoffTierSupported(server: number, tier: number): boolean {
  return getCutoffTierList(server).includes(tier);
}

/**
 * 解析档线活动时间，国服缺失时使用预估开始时间。
 *
 * @param input - 活动时间输入。
 * @returns 档线可用的开始与结束时间。
 */
export function resolveCutoffEventSchedule({
  currentEvent,
  endAt,
  eventId,
  server,
  startAt,
}: CutoffEventScheduleInput): { endAt: number | null; startAt: number | null } {
  const directStartAt = startAt[server];
  const directEndAt = endAt[server];
  if (directStartAt || server !== Server.cn) {
    return { endAt: directEndAt, startAt: directStartAt };
  }

  const estimatedStartAt = estimateCnEventStartAt(eventId, currentEvent);
  const jpStartAt = startAt[Server.jp];
  const jpEndAt = endAt[Server.jp];
  if (estimatedStartAt == null || jpStartAt == null || jpEndAt == null) {
    return { endAt: directEndAt, startAt: directStartAt };
  }
  return {
    endAt: estimatedStartAt + (jpEndAt - jpStartAt),
    startAt: estimatedStartAt,
  };
}

/**
 * 计算活动档线状态。
 *
 * @param startAt - 开始时间。
 * @param endAt - 结束时间。
 * @param now - 当前时间。
 * @returns 活动状态。
 */
export function getCutoffEventStatus(
  startAt: number | null,
  endAt: number | null,
  now = Date.now(),
): BangDreamEventStatus {
  if (startAt == null || endAt == null) return BangDreamEventStatus.ended;
  if (now < startAt) return BangDreamEventStatus.notStart;
  if (now > endAt) return BangDreamEventStatus.ended;
  return BangDreamEventStatus.inProgress;
}

/**
 * 获取预测窗口，统一使用档线对象已解析的时间。
 *
 * @param startAt - 开始时间。
 * @param endAt - 结束时间。
 * @returns 秒级预测窗口。
 */
export function getCutoffPredictionWindow(startAt: number, endAt: number) {
  return {
    endTs: Math.floor(endAt / 1000),
    startTs: Math.floor(startAt / 1000),
  };
}

/**
 * 计算时间点位于活动第几天。
 *
 * @param server - 目标服务器。
 * @param eventStartAt - 活动开始时间。
 * @param time - 目标时间。
 * @returns 活动天数索引。
 */
export function getCutoffDayIndex(
  server: number,
  eventStartAt: number,
  time: number | string,
) {
  if (!eventStartAt) return 0;
  const offsetMs = getBangDreamServerUtcOffset(server) * 60 * 60 * 1000;
  const eventStartAtTime = normalizeBangDreamTimestamp(eventStartAt);
  const timestamp = normalizeBangDreamTimestamp(time);
  const serverStartTime = eventStartAtTime + offsetMs;
  const startDate = new Date(serverStartTime);
  const firstDayEndServerTime =
    serverStartTime +
    (DAY_MS +
      FIRST_DAY_END_HOUR * 60 * 60 * 1000 -
      startDate.getUTCHours() * 60 * 60 * 1000 -
      startDate.getUTCMinutes() * 60 * 1000 -
      startDate.getUTCSeconds() * 1000 -
      startDate.getUTCMilliseconds());
  const firstDayEndTime = firstDayEndServerTime - offsetMs;
  if (timestamp < firstDayEndTime) return 0;
  return Math.ceil((timestamp - firstDayEndTime) / DAY_MS);
}

/**
 * 判断 Date 是否是档线日增 checkpoint。
 *
 * @param server - 目标服务器。
 * @param date - 已按服务器时区转换后的 Date。
 * @returns 是否为 checkpoint。
 */
export function isCutoffDailyCheckpoint(server: number, date: Date): boolean {
  return isBangDreamDailyCheckpoint(server, date);
}

/**
 * 将时间戳转换为服务器时区 Date。
 *
 * @param time - 秒级或毫秒级时间戳。
 * @param server - 目标服务器。
 * @returns 服务器时区 Date。
 */
export function getCutoffDateByServerTimezone(
  time: number | string,
  server: number,
): Date {
  return getBangDreamDateByServerTimezone(time, server);
}

/**
 * 选择用于档线对比的最近活动 ID。
 *
 * @param options - 活动候选和过滤条件。
 * @returns 最近活动 ID 列表。
 */
export function selectRecentCutoffEventIds({
  candidates,
  count,
  event,
  sameType = false,
  server,
}: CutoffRecentEventSelectionOptions): number[] {
  const eventStartAt = event.startAt[server];
  if (eventStartAt == null) return [];

  const matched = [...candidates]
    .filter((candidate) => candidate.startAt[server] != null)
    .sort((a, b) => b.startAt[server] - a.startAt[server])
    .filter((candidate) => {
      if (sameType && candidate.eventType !== event.eventType) return false;
      return candidate.startAt[server] <= eventStartAt;
    })
    .sort((a, b) => a.startAt[server] - b.startAt[server]);

  return matched
    .slice(Math.max(matched.length - count, 0))
    .map((item) => item.eventId);
}
