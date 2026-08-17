import { BangDreamServerId as Server } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

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
 * 将`time`规范为上游时间戳为毫秒，使等价输入得到一致表示；当 `timestamp < 1e12` 成立时返回 `timestamp * 1000`。
 * @param time - 决定上游时间戳为毫秒内容、边界或目标的 `time` 值。
 * @returns 上游时间戳为毫秒。
 */
export function normalizeBangDreamTimestamp(time: number | string): number {
  const timestamp = Number(time);
  if (timestamp < 1e12) {
    return timestamp * 1000;
  }
  return timestamp;
}

/**
 * 根据参数 `server`，获取服务器对应的 UTC 偏移小时数。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 规范化后的根据参数 `server`，获取服务器对应的 UTC 偏移小时数；主值为空时采用 `0` 兜底。
 */
export function getBangDreamServerUtcOffset(server: number): number {
  return SERVER_UTC_OFFSET_BY_SERVER[server] ?? 0;
}

/**
 * 将时间戳转换为目标服务器时区下的 Date。
 * @param time - 决定将时间戳转换为目标服务器时区下的 Date内容、边界或目标的 `time` 值。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 完成初始化并携带当前边界配置的将时间戳转换为目标服务器时区下的 Date。
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
 * 根据服务器配置判断是否存在每日档线检查点。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 满足根据服务器配置判断是否存在每日档线检查点约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function hasBangDreamDailyCheckpoint(server: number): boolean {
  return DAILY_CHECKPOINT_SERVERS.has(server);
}

/**
 * 根据服务器时区与检查点规则判断时间是否命中档线日增点。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param date - 用于根据服务器时区与检查点规则判断时间是否命中档线日增点的领域对象，包含 `getUTCHours`、`getUTCMinutes` 字段。
 * @returns 满足根据服务器时区与检查点规则判断时间是否命中档线日增点约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
