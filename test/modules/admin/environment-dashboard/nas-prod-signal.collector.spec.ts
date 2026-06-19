import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';
import { NasProdSignalCollector } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/collectors/nas-prod-signal.collector';

describe('NasProdSignalCollector', () => {
  it('contains QQBot offline state without marking API down', async () => {
    const collector = new NasProdSignalCollector(
      {
        getRuntimeHealth: jest.fn(() => ({
          checkedAt: '2026-06-18T08:00:00.000Z',
          checks: [],
          service: 'kt-template-online-api',
          status: 'live',
        })),
      } as any,
      {
        summary: jest.fn(async () => ({
          accountTotal: 2,
          bus: { connected: false, mode: 'local' },
          onlineTotal: 0,
          runtime: { enabled: true, sessions: [] },
        })),
      } as any,
      {
        pageTasks: jest.fn(async () => ({
          list: [
            {
              enabled: false,
              pluginKey: 'bangdream',
              runtimeStatus: 'disabled',
              taskKey: 'sync-bestdori-assets',
            },
          ],
          total: 1,
        })),
      } as any,
      {
        checkConnection: jest.fn(async () => {
          throw new Error('minio offline');
        }),
      } as any,
      {
        tryLoginWithConfiguredAdmin: jest.fn(async () => ({
          available: false,
          error: { message: 'wp unavailable', status: 502 },
          result: null,
        })),
      } as any,
      { inspect: jest.fn(async () => ({ id: 'jenkins-build' })) } as any,
      { inspect: jest.fn(async () => ({ id: 'k8s-deployment' })) } as any,
      new EnvironmentDashboardConfigService({}),
    );

    const site = await collector.collect({
      observedAt: '2026-06-18T08:00:00.000Z',
    });
    const services = site.nodes.flatMap((node) => node.services);

    expect(services.find((service) => service.id === 'nas-api')?.status).toBe(
      'ok',
    );
    expect(services.find((service) => service.id === 'qqbot-core')?.status).toBe(
      'degraded',
    );
    expect(services.find((service) => service.id === 'plugin-tasks')?.status).toBe(
      'degraded',
    );
    expect(services.find((service) => service.id === 'minio')?.status).toBe(
      'down',
    );
    expect(
      services.find((service) => service.id === 'jenkins')?.signals[0]
        .sourceKind,
    ).toBe('unwired');
    expect(
      services.find((service) => service.id === 'kubernetes')?.signals[0]
        .sourceKind,
    ).toBe('unwired');
  });
});
