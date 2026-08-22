/**
 * 将配置冷却和最小冷却收敛为非负有限数，并返回两者中较大的毫秒值。
 * @param cooldownMs - 用于Effective冷却时间Ms超时、有效期或退避计算的毫秒数。
 * @param minCooldownMs - 用于Effective冷却时间Ms超时、有效期或退避计算的毫秒数。
 * @returns Effective冷却时间Ms。
 */
export function getEffectiveCooldownMs(
  cooldownMs: number | null | undefined,
  minCooldownMs: number,
) {
  const cooldown = Number(cooldownMs || 0);
  const minimum = Number(minCooldownMs || 0);
  return Math.max(
    (() => {
      if (Number.isFinite(cooldown) && cooldown > 0) {
        return cooldown;
      }
      return 0;
    })(),
    (() => {
      if (Number.isFinite(minimum) && minimum > 0) {
        return minimum;
      }
      return 0;
    })(),
  );
}

/**
 * 根据`params`与当前约束判定Within冷却时间；从 `getEffectiveCooldownMs` 读取Within冷却时间。
 * @param params - 用于Within冷却时间的领域对象，包含 `lastHitAt`、`cooldownMs`、`minCooldownMs` 字段。
 * @returns 满足Within冷却时间约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isWithinCooldown(params: {
  cooldownMs: number | null | undefined;
  lastHitAt: Date | null | undefined;
  minCooldownMs: number;
}) {
  if (!params.lastHitAt) return false;
  const cooldownMs = getEffectiveCooldownMs(
    params.cooldownMs,
    params.minCooldownMs,
  );
  if (!cooldownMs) return false;
  return Date.now() - params.lastHitAt.getTime() < cooldownMs;
}
