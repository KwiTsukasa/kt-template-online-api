import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';
import { NasProdSignalCollector } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/collectors/nas-prod-signal.collector';

describe('NasProdSignalCollector', () => {
  it('contains Bot offline state without marking API down', async () => {
    const jenkinsAdapter = {
      inspect: jest.fn(async () => ({
        id: 'jenkins-build',
        label: 'Jenkins Build',
        sourceKind: 'live',
        status: 'ok',
        summary: 'Jenkins build is healthy',
      })),
    };
    const kubernetesAdapter = {
      inspect: jest.fn(async () => ({
        id: 'k8s-deployment',
        label: 'K8s Deployment',
        sourceKind: 'live',
        status: 'ok',
        summary: 'K8s deployment is healthy',
      })),
    };
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
      jenkinsAdapter as any,
      kubernetesAdapter as any,
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_JENKINS_JOB: 'KT-Template/API/main',
        ENV_DASHBOARD_JENKINS_URL: 'https://jenkins.example.test',
        ENV_DASHBOARD_K8S_API_SERVER: 'https://kubernetes.example.test',
        ENV_DASHBOARD_K8S_DEPLOYMENT: 'kt-template-online-api',
        ENV_DASHBOARD_K8S_NAMESPACE: 'kt-prod',
      }),
    );

    const site = await collector.collect({
      observedAt: '2026-06-18T08:00:00.000Z',
    });
    const services = site.nodes.flatMap((node) => node.services);

    expect(services.find((service) => service.id === 'nas-api')?.status).toBe(
      'ok',
    );
    expect(services.find((service) => service.id === 'bot-core')?.status).toBe(
      'degraded',
    );
    expect(
      services.find((service) => service.id === 'plugin-tasks')?.status,
    ).toBe('degraded');
    expect(services.find((service) => service.id === 'minio')?.status).toBe(
      'down',
    );
    expect(services.some((service) => service.id === 'wordpress')).toBe(false);
    expect(
      services.find((service) => service.id === 'jenkins')?.signals[0]
        .sourceKind,
    ).toBe('live');
    expect(
      services.find((service) => service.id === 'kubernetes')?.signals[0]
        .sourceKind,
    ).toBe('live');
    expect(jenkinsAdapter.inspect).toHaveBeenCalledTimes(1);
    expect(kubernetesAdapter.inspect).toHaveBeenCalledTimes(1);
  });
});
