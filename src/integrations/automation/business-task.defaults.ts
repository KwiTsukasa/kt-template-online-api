import type { ConfigService } from '@nestjs/config';

export type BusinessTaskDefault = {
  key: string;
  name: string;
  description: string;
  intervalMs: number;
  enabled: boolean;
  timeoutMs: number;
  idempotent: boolean;
};

/**
 * 从部署配置读取建议周期，仅在初次建立计划时采用，后续管理员配置不回写为默认值。
 * @param config - 当前 API 部署配置。
 * @returns 五项既有业务的初始计划和执行约束。
 */
export function businessTaskDefaults(
  config: Pick<ConfigService, 'get'>,
): BusinessTaskDefault[] {
  const duration = (key: string, fallback: number, min: number) => {
    const value = Number(config.get(key));
    if (Number.isFinite(value) && value >= min && value <= 86400000)
      return Math.floor(value);
    return fallback;
  };
  const watchdog = String(config.get('NAPCAT_WATCHDOG_ENABLED') ?? 'true')
    .trim()
    .toLowerCase();
  return [
    {
      key: 'message.delivery.scan',
      name: '系统消息投递扫描',
      description: '沿发件箱和订阅者的既有租约排空到期消息',
      intervalMs: 5000,
      enabled: true,
      timeoutMs: 300000,
      idempotent: false,
    },
    {
      key: 'media.rss.poll',
      name: '媒体 RSS 到期订阅扫描',
      description: '按订阅周期和乐观锁领取到期订阅，保留条目去重及集范围约束',
      intervalMs: 60000,
      enabled: true,
      timeoutMs: 300000,
      idempotent: true,
    },
    {
      key: 'media.execution.reconcile',
      name: '媒体执行状态核对',
      description: '沿已有运行身份核对媒体状态并重试未确认投递',
      intervalMs: 5000,
      enabled: true,
      timeoutMs: 300000,
      idempotent: true,
    },
    {
      key: 'network.ddns.reconcile',
      name: 'DDNS 周期核对',
      description: '沿既有租约和 DNS 身份约束核对记录',
      intervalMs: duration('NETWORK_DDNS_RECONCILE_INTERVAL_MS', 60000, 1000),
      enabled: true,
      timeoutMs: 300000,
      idempotent: true,
    },
    {
      key: 'napcat.offline.inspect',
      name: 'NapCat 离线状态巡检',
      description: '只核对账户离线状态，禁止自动登录恢复',
      intervalMs: duration('NAPCAT_WATCHDOG_INTERVAL_MS', 120000, 30000),
      enabled: !['false', '0', 'off'].includes(watchdog),
      timeoutMs: 120000,
      idempotent: true,
    },
  ];
}
