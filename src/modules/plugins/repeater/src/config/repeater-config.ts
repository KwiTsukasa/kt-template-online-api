import type { RepeaterPluginHost } from '../infrastructure/integration/repeater-host';

export type RepeaterRuntimeConfig = {
  configCacheTtlMs: number;
  maxTextLength: number;
  minIntervalMs: number;
  stateTtlMs: number;
  threshold: number;
};

/**
 * 按`host`读取针对复读插件；从 `getNumberConfig` 读取针对复读插件。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @returns 包含 `configCacheTtlMs`、`maxTextLength`、`minIntervalMs`、`stateTtlMs`、`threshold` 字段的针对复读插件。
 */
export function readRepeaterRuntimeConfig(
  host: RepeaterPluginHost,
): RepeaterRuntimeConfig {
  return {
    configCacheTtlMs: getNumberConfig(
      host,
      'PLUGIN_REPEATER_CONFIG_CACHE_TTL_MS',
      2000,
      (value) => value > 0,
    ),
    maxTextLength: getNumberConfig(
      host,
      'PLUGIN_REPEATER_MAX_TEXT_LENGTH',
      120,
      (value) => value > 0,
    ),
    minIntervalMs: getNumberConfig(
      host,
      'PLUGIN_REPEATER_MIN_INTERVAL_MS',
      10 * 60 * 1000,
      (value) => value > 0,
    ),
    stateTtlMs: getNumberConfig(
      host,
      'PLUGIN_REPEATER_STATE_TTL_MS',
      10 * 60 * 1000,
      (value) => value > 0,
    ),
    threshold: getNumberConfig(
      host,
      'PLUGIN_REPEATER_THRESHOLD',
      4,
      (value) => value > 1,
    ),
  };
}

/**
 * 按`host`、`key`、`fallback`读取针对复读插件；当 `Number.isInteger(value) && valid(value)` 成立时返回 `value`。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param key - 用于读取或更新针对复读插件的稳定键。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @param valid - 负责完成针对复读插件外部交互的受控能力。
 * @returns 针对复读插件。
 */
function getNumberConfig(
  host: RepeaterPluginHost,
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
) {
  const value = Number(host.getConfig(key));
  if (Number.isInteger(value) && valid(value)) {
    return value;
  }
  return fallback;
}
