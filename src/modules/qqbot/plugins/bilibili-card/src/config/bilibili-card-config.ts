import type {
  BilibiliCardPluginHost,
  BilibiliCardRuntimeConfig,
} from '../domain/bilibili-card.types';

const CONFIG_RULES = {
  dedupeTtlMs: {
    defaultValue: 600000,
    key: 'QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS',
    max: 3600000,
    min: 0,
  },
  descMaxLength: {
    defaultValue: 80,
    key: 'QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH',
    max: 300,
    min: 0,
  },
  httpTimeoutMs: {
    defaultValue: 6000,
    key: 'QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS',
    max: 15000,
    min: 1000,
  },
  maxRedirects: {
    defaultValue: 5,
    key: 'QQBOT_BILIBILI_CARD_MAX_REDIRECTS',
    max: 10,
    min: 0,
  },
} as const;

/** 读取Bilibili卡片运行态配置。 */
export function readBilibiliCardRuntimeConfig(
  host: BilibiliCardPluginHost,
): BilibiliCardRuntimeConfig {
  return {
    dedupeTtlMs: readClampedInteger(host, CONFIG_RULES.dedupeTtlMs),
    descMaxLength: readClampedInteger(host, CONFIG_RULES.descMaxLength),
    httpTimeoutMs: readClampedInteger(host, CONFIG_RULES.httpTimeoutMs),
    maxRedirects: readClampedInteger(host, CONFIG_RULES.maxRedirects),
  };
}

/** 读取已限定范围的整数。 */
function readClampedInteger(
  host: BilibiliCardPluginHost,
  rule: {
    defaultValue: number;
    key: string;
    max: number;
    min: number;
  },
) {
  const value = Number(host.getConfig(rule.key));
  const normalized = Number.isFinite(value)
    ? Math.trunc(value)
    : rule.defaultValue;
  return Math.min(rule.max, Math.max(rule.min, normalized));
}
