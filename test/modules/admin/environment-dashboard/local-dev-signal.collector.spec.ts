import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';
import { LocalDevSignalCollector } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/collectors/local-dev-signal.collector';

describe('LocalDevSignalCollector', () => {
  it('uses runtime health for the local API service and configured Admin URL evidence', async () => {
    const runtime = {
      getRuntimeHealth: jest.fn(() => ({
        checkedAt: '2026-06-18T08:00:00.000Z',
        checks: [
          {
            critical: true,
            message: 'process live',
            name: 'process',
            status: 'live',
          },
        ],
        service: 'kt-template-online-api',
        status: 'degraded',
      })),
    };
    const config = new EnvironmentDashboardConfigService({
      ENV_DASHBOARD_ADMIN_LOCAL_URL: 'http://127.0.0.1:5999',
    });
    const collector = new LocalDevSignalCollector(runtime as any, config);

    const site = await collector.collect({
      observedAt: '2026-06-18T08:00:00.000Z',
    });

    const apiService = site.nodes[0].services.find(
      (service) => service.id === 'local-api',
    );
    const adminService = site.nodes[0].services.find(
      (service) => service.id === 'local-admin',
    );

    expect(site.id).toBe('local-dev');
    expect(apiService?.status).toBe('degraded');
    expect(apiService?.signals[0].evidence[0].metadata).toMatchObject({
      runtimeStatus: 'degraded',
    });
    expect(adminService?.signals[0]).toMatchObject({
      sourceKind: 'configured',
      status: 'unknown',
    });
  });
});
