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

/**
 * 按`host`读取Bilibili卡片运行态配置；从 `readClampedInteger` 读取Bilibili卡片运行态配置。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @returns 包含 `dedupeTtlMs`、`descMaxLength`、`httpTimeoutMs`、`maxRedirects` 字段的Bilibili卡片运行态配置。
 */
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

/**
 * 按`host`、`rule`读取已限定范围的整数；从 `host.getConfig` 读取已限定范围的整数。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param rule - 用于已限定范围的整数的领域对象，包含 `key`、`defaultValue`、`max`、`min` 字段。
 * @returns 已限定范围的整数。
 */
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
  const normalized = (() => {
    if (Number.isFinite(value)) {
      return Math.trunc(value);
    }
    return rule.defaultValue;
  })();
  return Math.min(rule.max, Math.max(rule.min, normalized));
}
