import { EnvironmentDashboardService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard.service';
import { EnvironmentEventMaterializer } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event.materializer';

describe('EnvironmentDashboardService', () => {
  it('returns four sites with explicit unwired remote evidence', async () => {
    const service = new EnvironmentDashboardService(
      new EnvironmentEventMaterializer(),
    );

    const dashboard = await service.getDashboard();

    expect(dashboard.sites.map((site) => site.id)).toEqual([
      'local-dev',
      'nas-prod',
      'tencent-cloud',
      'r4se',
    ]);
    expect(dashboard.summary.totalSignals).toBeGreaterThan(0);
    expect(
      dashboard.sites
        .flatMap((site) => site.nodes)
        .flatMap((node) => node.services)
        .flatMap((serviceItem) => serviceItem.signals)
        .some(
          (signal) =>
            signal.sourceKind === 'unwired' &&
            /Jenkins|K8s|Tencent|r4se|WireGuard|Mihomo/.test(signal.label),
        ),
    ).toBe(true);
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
  });
});
