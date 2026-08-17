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
 * 根据参数 `server`，获取指定服务器支持的档位列表。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 按输入顺序得到的根据参数 `server`，获取指定服务器支持的档位列表；没有匹配项时为空数组。
 */
export function getCutoffTierList(server: number): readonly number[] {
  return BANGDREAM_TIER_LIST_BY_SERVER[Server[server]] ?? [];
}

/**
 * 根据参数 `server`，判断服务器是否支持指定档位。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param tier - 决定根据参数 `server`，判断服务器是否支持指定档位内容、边界或目标的 `tier` 值。
 * @returns 满足根据参数 `server`，判断服务器是否支持指定档位约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isCutoffTierSupported(server: number, tier: number): boolean {
  return getCutoffTierList(server).includes(tier);
}

/**
 * 解析档线活动时间，国服缺失时使用预估开始时间。
 * @returns 包含 `endAt`、`startAt` 字段的档线活动时间，国服缺失时使用预估开始时间。
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
 * 按`startAt`、`endAt`、`now`读取活动档线状态。
 * @param startAt - 用于过期、排序或租约判定的时间基准。
 * @param endAt - 用于过期、排序或租约判定的时间基准。
 * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `Date.now()`。
 * @returns 活动档线状态。
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
 * 根据参数 `startAt`，获取预测窗口，统一使用档线对象已解析的时间。
 * @param startAt - 用于过期、排序或租约判定的时间基准。
 * @param endAt - 用于过期、排序或租约判定的时间基准。
 * @returns 包含 `endTs`、`startTs` 字段的根据参数 `startAt`，获取预测窗口，统一使用档线对象已解析的时间。
 */
export function getCutoffPredictionWindow(startAt: number, endAt: number) {
  return {
    endTs: Math.floor(endAt / 1000),
    startTs: Math.floor(startAt / 1000),
  };
}

/**
 * 根据参数 `server`，计算时间点位于活动第几天。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param eventStartAt - 用于过期、排序或租约判定的时间基准。
 * @param time - 决定根据参数 `server`，计算时间点位于活动第几天内容、边界或目标的 `time` 值。
 * @returns 当前状态对应的根据参数 `server`，计算时间点位于活动第几天，取值为 `0`。
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
 * 根据时间是否命中每日档线检查点判断当前日期是否需要日增采样。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param date - 决定根据时间是否命中每日档线检查点判断当前日期是否需要日增采样内容、边界或目标的 `date` 值。
 * @returns 满足根据时间是否命中每日档线检查点判断当前日期是否需要日增采样约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isCutoffDailyCheckpoint(server: number, date: Date): boolean {
  return isBangDreamDailyCheckpoint(server, date);
}

/**
 * 将时间戳转换为服务器时区 Date。
 * @param time - 决定将时间戳转换为服务器时区 Date内容、边界或目标的 `time` 值。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 将时间戳转换为服务器时区 Date。
 */
export function getCutoffDateByServerTimezone(
  time: number | string,
  server: number,
): Date {
  return getBangDreamDateByServerTimezone(time, server);
}

/**
 * 按活动开始时间倒序筛选指定结束点之前的档线活动，并返回最近的有界 ID 集合。
 * @returns 按输入顺序得到的select最近日志档线事件标识集合列表；没有匹配项时为空数组。
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
