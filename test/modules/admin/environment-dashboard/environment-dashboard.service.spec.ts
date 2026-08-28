import { EnvironmentDashboardService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard.service';
import { EnvironmentEventMaterializer } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event.materializer';

describe('EnvironmentDashboardService', () => {
  it('returns the exact three-device and seven-service authoritative topology', async () => {
    const service = new EnvironmentDashboardService(
      new EnvironmentEventMaterializer(),
    );

    const dashboard = await service.getDashboard();

    expect(dashboard.sites.map((site) => site.id)).toEqual([
      'windows-pc',
      'nas-prod',
      'r4se',
    ]);
    expect(dashboard.sites.map((site) => site.label)).toEqual([
      'Windows PC',
      'NAS',
      'R4SE',
    ]);
    expect(dashboard.summary.totalSignals).toBeGreaterThan(0);
    const topologyNodeIds = dashboard.topology.nodes.map((node) => node.id);
    expect(topologyNodeIds).toEqual(
      expect.arrayContaining([
        'windows-pc',
        'nas-prod',
        'r4se',
        'sunshine',
        'codex-app-server',
        'nas-api',
        'home-assistant',
        'bot-core',
        'r4se-wireguard',
        'r4se-mihomo',
      ]),
    );
    const serviceIds = dashboard.sites
      .flatMap((site) => site.nodes)
      .flatMap((node) => node.services)
      .map((serviceItem) => serviceItem.id);
    expect(serviceIds).toEqual([
      'sunshine',
      'codex-app-server',
      'nas-api',
      'home-assistant',
      'bot-core',
      'r4se-wireguard',
      'r4se-mihomo',
    ]);
    expect(JSON.stringify(dashboard)).not.toMatch(
      /local-dev|tencent-cloud|Tencent Cloud|Caddy/,
    );
  });

  it('keeps high-risk actions visible but disabled', async () => {
    const service = new EnvironmentDashboardService(
      new EnvironmentEventMaterializer(),
    );

    const dashboard = await service.getDashboard();
    const deployAction = dashboard.actions.find(
      (action) => action.id === 'trigger-jenkins-deploy',
    );

    expect(deployAction).toMatchObject({
      enabled: false,
      id: 'trigger-jenkins-deploy',
    });
    expect(deployAction?.disabledReason).toContain('只读');
    expect(
      dashboard.actions.some((action) => action.id === 'wordpress-import'),
    ).toBe(false);
    expect(
      dashboard.actions.some((action) => action.id === 'reload-caddy'),
    ).toBe(false);
    expect(
      dashboard.actions.some((action) => action.id === 'restart-tencent-cvm'),
    ).toBe(false);
  });
});
