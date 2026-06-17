import {
  BangDreamEventStatus,
  BangDreamServerId as Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  estimateCnEventStartAt,
  type BangDreamEventTimeLike,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/cn-event-estimate.policy';
import {
  getBangDreamDateByServerTimezone,
  getBangDreamServerUtcOffset,
  isBangDreamDailyCheckpoint,
  normalizeBangDreamTimestamp,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/server.policy';
import { BANGDREAM_TIER_LIST_BY_SERVER } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';

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
 * @param server - server 输入；限定 BangDream查询范围。
 * @returns 档位列表。
 */
export function getCutoffTierList(server: number): readonly number[] {
  return BANGDREAM_TIER_LIST_BY_SERVER[Server[server]] ?? [];
}

/**
 * 判断服务器是否支持指定档位。
 *
 * @param server - server 输入；驱动 `getCutoffTierList()` 的 BangDream步骤。
 * @param tier - tier 输入；驱动 `getCutoffTierList()` 的 BangDream步骤。
 * @returns 是否支持。
 */
export function isCutoffTierSupported(server: number, tier: number): boolean {
  return getCutoffTierList(server).includes(tier);
}

/**
 * 解析档线活动时间，国服缺失时使用预估开始时间。
 *
 * @param input - input 输入；影响 resolveCutoffEventSchedule 的返回值。
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
 * @param startAt - startAt 输入；决定 BangDream条件分支。
 * @param endAt - endAt 输入；决定 BangDream条件分支。
 * @param now - now 输入；决定 BangDream条件分支。
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
 * @param startAt - startAt 输入；驱动 `Math.floor()` 的 BangDream步骤。
 * @param endAt - endAt 输入；驱动 `Math.floor()` 的 BangDream步骤。
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
 * @param server - server 输入；驱动 `getBangDreamServerUtcOffset()` 的 BangDream步骤。
 * @param eventStartAt - eventStartAt 输入；驱动 `normalizeBangDreamTimestamp()` 的 BangDream步骤。
 * @param time - time 输入；驱动 `normalizeBangDreamTimestamp()` 的 BangDream步骤。
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
 * @param server - server 输入；驱动 `isBangDreamDailyCheckpoint()` 的 BangDream步骤。
 * @param date - date 输入；驱动 `isBangDreamDailyCheckpoint()` 的 BangDream步骤。
 * @returns 是否为 checkpoint。
 */
export function isCutoffDailyCheckpoint(server: number, date: Date): boolean {
  return isBangDreamDailyCheckpoint(server, date);
}

/**
 * 将时间戳转换为服务器时区 Date。
 *
 * @param time - time 输入；驱动 `getBangDreamDateByServerTimezone()` 的 BangDream步骤。
 * @param server - server 输入；驱动 `getBangDreamDateByServerTimezone()` 的 BangDream步骤。
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
 * @param options - BangDream列表；影响 selectRecentCutoffEventIds 的返回值。
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
