import { BangDreamServerId as Server } from '@/qqbot/plugins/bangDream/shared/bangdream-protocol';

const SERVER_UTC_OFFSET_BY_SERVER: Record<number, number> = {
  [Server.cn]: 8,
  [Server.en]: 0,
  [Server.jp]: 9,
  [Server.kr]: 9,
  [Server.tw]: 8,
};

const DAILY_CHECKPOINT_SERVERS = new Set<number>([
  Server.cn,
  Server.jp,
  Server.tw,
]);

/**
 * 规范化上游时间戳为毫秒。
 *
 * @param time - 秒级或毫秒级时间戳。
 * @returns 毫秒级时间戳。
 */
export function normalizeBangDreamTimestamp(time: number | string): number {
  const timestamp = Number(time);
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

/**
 * 获取服务器对应的 UTC 偏移小时数。
 *
 * @param server - 目标服务器。
 * @returns UTC 偏移小时数。
 */
export function getBangDreamServerUtcOffset(server: number): number {
  return SERVER_UTC_OFFSET_BY_SERVER[server] ?? 0;
}

/**
 * 将时间戳转换为目标服务器时区下的 Date。
 *
 * @param time - 秒级或毫秒级时间戳。
 * @param server - 目标服务器。
 * @returns 服务器时区 Date。
 */
export function getBangDreamDateByServerTimezone(
  time: number | string,
  server: number,
): Date {
  const timestamp = normalizeBangDreamTimestamp(time);
  const offset = getBangDreamServerUtcOffset(server);
  return new Date(timestamp + offset * 60 * 60 * 1000);
}

/**
 * 判断服务器是否存在每日档线 checkpoint。
 *
 * @param server - 目标服务器。
 * @returns 是否启用每日 checkpoint。
 */
export function hasBangDreamDailyCheckpoint(server: number): boolean {
  return DAILY_CHECKPOINT_SERVERS.has(server);
}

/**
 * 判断时间是否命中档线日增 checkpoint。
 *
 * @param server - 目标服务器。
 * @param date - 已按服务器时区转换后的 Date。
 * @returns 是否命中 checkpoint。
 */
export function isBangDreamDailyCheckpoint(
  server: number,
  date: Date,
): boolean {
  return (
    hasBangDreamDailyCheckpoint(server) &&
    date.getUTCHours() === 3 &&
    date.getUTCMinutes() === 45
  );
}
