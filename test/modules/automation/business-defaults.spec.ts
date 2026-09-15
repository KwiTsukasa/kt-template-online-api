import { businessTaskDefaults } from '@/integrations/automation/business-task.defaults';

describe('业务默认计划配置', () => {
  it('保留离线检查默认停用及安全间隔，并限制 DDNS 周期边界', () => {
    const values = { NAPCAT_WATCHDOG_ENABLED: 'off', NAPCAT_WATCHDOG_INTERVAL_MS: '1000', NETWORK_DDNS_RECONCILE_INTERVAL_MS: '90000000' };
    const defaults = businessTaskDefaults({ get: (key: string) => values[key] } as any);
    expect(defaults.find((item) => item.key === 'napcat.offline.inspect')).toMatchObject({ enabled: false, intervalMs: 120000 });
    expect(defaults.find((item) => item.key === 'network.ddns.reconcile')?.intervalMs).toBe(60000);
    expect(defaults.find((item) => item.key === 'message.delivery.scan')?.idempotent).toBe(false);
  });

  it('采用现有有效部署周期，不读取插件平台配置', () => {
    const keys: string[] = [];
    const defaults = businessTaskDefaults({ get: (key: string) => { keys.push(key); return { NAPCAT_WATCHDOG_INTERVAL_MS: '30000', NETWORK_DDNS_RECONCILE_INTERVAL_MS: '10000' }[key]; } } as any);
    expect(defaults.find((item) => item.key === 'napcat.offline.inspect')?.intervalMs).toBe(30000);
    expect(defaults.find((item) => item.key === 'network.ddns.reconcile')?.intervalMs).toBe(10000);
    expect(keys.every((key) => !key.includes('PLUGIN'))).toBe(true);
  });
});
