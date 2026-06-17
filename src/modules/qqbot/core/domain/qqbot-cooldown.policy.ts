/**
 * 查询 QQBot 核心数据。
 * @param cooldownMs - QQBot列表；驱动 `Number()` 的 QQBot步骤。
 * @param minCooldownMs - QQBot列表；驱动 `Number()` 的 QQBot步骤。
 */
export function getEffectiveCooldownMs(
  cooldownMs: number | null | undefined,
  minCooldownMs: number,
) {
  const cooldown = Number(cooldownMs || 0);
  const minimum = Number(minCooldownMs || 0);
  return Math.max(
    Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 0,
    Number.isFinite(minimum) && minimum > 0 ? minimum : 0,
  );
}

/**
 * 判断 QQBot 核心条件。
 * @param params - QQBot列表；使用 `lastHitAt`、`cooldownMs`、`minCooldownMs` 字段计算判断结果。
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
