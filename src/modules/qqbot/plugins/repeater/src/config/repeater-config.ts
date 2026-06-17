import type { RepeaterPluginHost } from '../infrastructure/integration/repeater-host';

export type RepeaterRuntimeConfig = {
  configCacheTtlMs: number;
  maxTextLength: number;
  minIntervalMs: number;
  stateTtlMs: number;
  threshold: number;
};

/**
 * 读取 复读插件资源。
 * @param host - host 输入；驱动 `getNumberConfig()` 的 模块步骤。
 * @returns 复读插件产出的 RepeaterRuntimeConfig。
 */
export function readRepeaterRuntimeConfig(
  host: RepeaterPluginHost,
): RepeaterRuntimeConfig {
  return {
    configCacheTtlMs: getNumberConfig(
      host,
      'QQBOT_REPEATER_CONFIG_CACHE_TTL_MS',
      2000,
      (value) => value > 0,
    ),
    maxTextLength: getNumberConfig(
      host,
      'QQBOT_REPEATER_MAX_TEXT_LENGTH',
      120,
      (value) => value > 0,
    ),
    minIntervalMs: getNumberConfig(
      host,
      'QQBOT_REPEATER_MIN_INTERVAL_MS',
      10 * 60 * 1000,
      (value) => value > 0,
    ),
    stateTtlMs: getNumberConfig(
      host,
      'QQBOT_REPEATER_STATE_TTL_MS',
      10 * 60 * 1000,
      (value) => value > 0,
    ),
    threshold: getNumberConfig(
      host,
      'QQBOT_REPEATER_THRESHOLD',
      4,
      (value) => value > 1,
    ),
  };
}

/**
 * 查询 复读插件数据。
 * @param host - host 输入；执行 `host.getConfig()` 对应的 模块步骤。
 * @param key - 键名；驱动 `Number()` 的 模块步骤。
 * @param fallback - 兜底值；驱动 `Number.isInteger()` 的 模块步骤。
 * @param valid - 模块 ID；定位本次读取、更新、删除或关联的模块。
 */
function getNumberConfig(
  host: RepeaterPluginHost,
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
) {
  const value = Number(host.getConfig(key));
  return Number.isInteger(value) && valid(value) ? value : fallback;
}
