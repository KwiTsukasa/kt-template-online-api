import { CaddyReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/caddy-readonly.adapter';
import { JenkinsReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/jenkins-readonly.adapter';
import { KubernetesReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/kubernetes-readonly.adapter';
import { MihomoReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/mihomo-readonly.adapter';
import { TencentCloudReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/tencent-cloud-readonly.adapter';
import { WireguardReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/wireguard-readonly.adapter';
import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';

describe('environment remote readonly adapters', () => {
  const config = new EnvironmentDashboardConfigService({});

  it.each([
    ['Jenkins', new JenkinsReadonlyAdapter(config)],
    ['K8s', new KubernetesReadonlyAdapter(config)],
    ['Tencent Cloud', new TencentCloudReadonlyAdapter(config)],
    ['Caddy', new CaddyReadonlyAdapter(config)],
    ['WireGuard', new WireguardReadonlyAdapter(config)],
    ['Mihomo', new MihomoReadonlyAdapter(config)],
  ])(
    '%s returns unwired evidence when config is missing',
    async (_, adapter) => {
      const signal = await adapter.inspect();

      expect(signal.status).toBe('unwired');
      expect(signal.sourceKind).toBe('unwired');
      expect(signal.evidence[0].summary).toContain('缺少只读观测配置');
    },
  );

  it('keeps credential keys visible as missing config without exposing values', async () => {
    const tencentSignal = await new TencentCloudReadonlyAdapter(
      config,
    ).inspect();
    const mihomoSignal = await new MihomoReadonlyAdapter(config).inspect();

    expect(tencentSignal.evidence[0].metadata?.missingConfigKeys).toContain(
      'ENV_DASHBOARD_TENCENT_SECRET_KEY',
    );
    expect(mihomoSignal.evidence[0].metadata?.missingConfigKeys).toContain(
      'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
    );
  });
});
