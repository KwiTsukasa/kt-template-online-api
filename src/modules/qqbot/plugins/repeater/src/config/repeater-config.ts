import type { RepeaterPluginHost } from '../infrastructure/integration/repeater-host';

export type RepeaterRuntimeConfig = {
  configCacheTtlMs: number;
  maxTextLength: number;
  minIntervalMs: number;
  stateTtlMs: number;
  threshold: number;
};

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

function getNumberConfig(
  host: RepeaterPluginHost,
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
) {
  const value = Number(host.getConfig(key));
  return Number.isInteger(value) && valid(value) ? value : fallback;
}
