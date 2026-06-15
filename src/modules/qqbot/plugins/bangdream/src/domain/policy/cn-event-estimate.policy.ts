import { bangdreamCatalogRepository } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { stringToNumberArray } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { BangDreamServerId as Server } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  BANGDREAM_CN_BLOCKED_EVENT_IDS,
  BANGDREAM_CN_ESTIMATE_START_EVENT_ID,
  BANGDREAM_DEFAULT_NO_BANG_DAYS,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_EVENT_LOOKBACK_MS = DAY_MS;

export interface BangDreamEventSchedule {
  endAt: Array<number | null>;
  startAt: Array<number | null>;
}

export interface BangDreamEventTimeLike extends BangDreamEventSchedule {
  eventId: number;
}

export interface CnEventEstimatePolicyOptions {
  blockedEventIds?: readonly number[];
  defaultNoBangDays?: number;
  estimateStartEventId?: number;
}

export interface CnEventEstimateCalculationContext {
  currentEvent: BangDreamEventTimeLike;
  eventId: number;
  getSchedule: (eventId: number) => BangDreamEventSchedule | null;
  options?: CnEventEstimatePolicyOptions;
  presentJpEventId: number;
}

/**
 * 读取活动时间表，避免国服预估逻辑依赖 Event class。
 *
 * @param eventId - 活动 ID。
 * @returns 活动时间表。
 */
export function getBangDreamEventSchedule(
  eventId: number,
): BangDreamEventSchedule | null {
  const eventData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
    'events',
    eventId,
  );
  if (!eventData) return null;
  return {
    endAt: stringToNumberArray(eventData.endAt),
    startAt: stringToNumberArray(eventData.startAt),
  };
}

/**
 * 获取某服务器当前或最近结束的活动 ID。
 *
 * @param server - 目标服务器。
 * @param time - 查询时间，默认当前时间。
 * @returns 活动 ID。
 */
export function getPresentBangDreamEventId(
  server: number,
  time = Date.now(),
): number | null {
  const eventIds = bangdreamCatalogRepository.getNumericIds('events');
  const activeEventIds: number[] = [];
  let latestEndedEventId: number | null = null;
  let latestEndedAt = 0;

  for (const eventId of eventIds) {
    const schedule = getBangDreamEventSchedule(eventId);
    const startAt = schedule?.startAt[server];
    const endAt = schedule?.endAt[server];
    if (startAt == null || endAt == null) continue;

    if (startAt - ACTIVE_EVENT_LOOKBACK_MS <= time && endAt >= time) {
      activeEventIds.push(eventId);
      continue;
    }
    if (endAt <= time && endAt > latestEndedAt) {
      latestEndedAt = endAt;
      latestEndedEventId = eventId;
    }
  }

  if (activeEventIds.length > 0) {
    return activeEventIds[activeEventIds.length - 1];
  }
  return latestEndedEventId;
}

/**
 * 计算活动跨越的自然日数量，首尾日都计入。
 *
 * @param startTs - 开始时间。
 * @param endTs - 结束时间。
 * @returns 自然日数量。
 */
export function getBangDreamOccupiedDays(
  startTs: number,
  endTs: number,
): number {
  const start = new Date(startTs);
  const end = new Date(endTs);
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
}

/**
 * 纯函数计算国服预估开放时间。
 *
 * @param context - 预估所需活动上下文。
 * @returns 预估开始时间。
 */
export function calculateCnEventEstimateStartAt({
  currentEvent,
  eventId,
  getSchedule,
  options,
  presentJpEventId,
}: CnEventEstimateCalculationContext): number | null {
  const policyOptions = {
    blockedEventIds: BANGDREAM_CN_BLOCKED_EVENT_IDS,
    defaultNoBangDays: BANGDREAM_DEFAULT_NO_BANG_DAYS,
    estimateStartEventId: BANGDREAM_CN_ESTIMATE_START_EVENT_ID,
    ...options,
  };
  const currentStartCn = currentEvent.startAt[Server.cn];
  const currentEndCn = currentEvent.endAt[Server.cn];
  const currentStartJp = currentEvent.startAt[Server.jp];
  const currentEndJp = currentEvent.endAt[Server.jp];
  if (
    currentStartCn == null ||
    currentEndCn == null ||
    currentStartJp == null ||
    currentEndJp == null
  ) {
    return null;
  }

  const eventLenOffset =
    getBangDreamOccupiedDays(currentStartCn, currentEndCn) -
    getBangDreamOccupiedDays(currentStartJp, currentEndJp);
  const currentEventOffset = calculateCurrentEventOffset({
    currentEvent,
    eventLenOffset,
    getSchedule,
    policyOptions,
    presentJpEventId,
  });
  if (currentEventOffset == null) return null;

  let probableTimeOffset = currentStartCn;
  for (let i = policyOptions.estimateStartEventId; i < presentJpEventId; i++) {
    const schedule = getSchedule(i);
    if (!schedule) continue;
    if (!schedule.startAt[Server.cn]) {
      const nextSchedule = getSchedule(i + 1);
      if (!nextSchedule) continue;
      probableTimeOffset +=
        (getBangDreamOccupiedDays(
          schedule.startAt[Server.jp],
          nextSchedule.startAt[Server.jp],
        ) -
          1) *
        DAY_MS;
    }
    if (i + 1 === eventId) return probableTimeOffset + currentEventOffset;
    if (policyOptions.blockedEventIds.includes(i + 1)) continue;
  }

  const presentJpSchedule = getSchedule(presentJpEventId);
  if (
    !presentJpSchedule ||
    presentJpSchedule.startAt[Server.jp] == null ||
    presentJpSchedule.endAt[Server.jp] == null
  ) {
    return null;
  }
  const presentJpEventLength =
    (getBangDreamOccupiedDays(
      presentJpSchedule.startAt[Server.jp],
      presentJpSchedule.endAt[Server.jp],
    ) +
      policyOptions.defaultNoBangDays) *
    DAY_MS;
  return probableTimeOffset + currentEventOffset + presentJpEventLength;
}

/**
 * 按当前主数据计算国服预估开放时间。
 *
 * @param eventId - 目标活动 ID。
 * @param currentEvent - 国服当前活动。
 * @returns 预估开始时间。
 */
export function estimateCnEventStartAt(
  eventId: number,
  currentEvent: BangDreamEventTimeLike | null,
): number | null {
  if (!currentEvent) return null;
  const presentJpEventId = getPresentBangDreamEventId(Server.jp);
  if (presentJpEventId == null) return null;
  return calculateCnEventEstimateStartAt({
    currentEvent,
    eventId,
    getSchedule: getBangDreamEventSchedule,
    presentJpEventId,
  });
}

function calculateCurrentEventOffset({
  currentEvent,
  eventLenOffset,
  getSchedule,
  policyOptions,
  presentJpEventId,
}: {
  currentEvent: BangDreamEventTimeLike;
  eventLenOffset: number;
  getSchedule: (eventId: number) => BangDreamEventSchedule | null;
  policyOptions: Required<CnEventEstimatePolicyOptions>;
  presentJpEventId: number;
}) {
  const currentEventId = currentEvent.eventId;
  if (currentEventId < presentJpEventId) {
    const nextSchedule = getSchedule(currentEventId + 1);
    if (!nextSchedule || nextSchedule.startAt[Server.jp] == null) return null;
    return (
      (getBangDreamOccupiedDays(
        currentEvent.startAt[Server.jp],
        nextSchedule.startAt[Server.jp],
      ) -
        1 +
        eventLenOffset) *
      DAY_MS
    );
  }
  if (currentEventId === presentJpEventId) {
    const previousSchedule = getSchedule(currentEventId - 1);
    if (!previousSchedule || previousSchedule.endAt[Server.jp] == null) {
      return null;
    }
    return (
      (getBangDreamOccupiedDays(
        previousSchedule.endAt[Server.jp],
        currentEvent.endAt[Server.jp],
      ) -
        1 +
        eventLenOffset) *
      DAY_MS
    );
  }
  return (
    (getBangDreamOccupiedDays(
      currentEvent.startAt[Server.cn],
      currentEvent.endAt[Server.cn],
    ) +
      policyOptions.defaultNoBangDays) *
    DAY_MS
  );
}
