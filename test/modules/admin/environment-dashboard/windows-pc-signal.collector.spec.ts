import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';
import { WindowsPcSignalCollector } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/collectors/windows-pc-signal.collector';

describe('WindowsPcSignalCollector', () => {
  it('projects Sunshine and Codex Thread Index in design order', async () => {
    const sunshine = {
      inspect: jest.fn(async () => ({
        evidence: [],
        id: 'sunshine-api',
        label: 'Sunshine API',
        sourceKind: 'live',
        status: 'ok',
        summary: 'Sunshine API 可用',
      })),
    };
    const codex = {
      inspect: jest.fn(async () => ({
        evidence: [],
        id: 'codex-thread-index-ready',
        label: 'Codex Thread Index',
        sourceKind: 'live',
        status: 'ok',
        summary: 'Codex Thread Index 已就绪',
      })),
    };
    const collector = new WindowsPcSignalCollector(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_CODEX_THREAD_INDEX_URL: 'http://windows.example:48094',
        ENV_DASHBOARD_SUNSHINE_PASSWORD: 'sun-secret',
        ENV_DASHBOARD_SUNSHINE_URL: 'https://windows.example:39000',
        ENV_DASHBOARD_SUNSHINE_USERNAME: 'kwicore',
      }),
      sunshine as any,
      codex as any,
    );

    const site = await collector.collect();
    const services = site.nodes[0]?.services || [];

    expect(site).toMatchObject({
      id: 'windows-pc',
      label: 'Windows PC',
      status: 'online',
    });
    expect(services.map((service) => service.id)).toEqual([
      'sunshine',
      'codex-thread-index',
    ]);
    expect(services.every((service) => service.status === 'ok')).toBe(true);
    expect(sunshine.inspect).toHaveBeenCalledTimes(1);
    expect(codex.inspect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(site)).not.toContain('sun-secret');
  });
});
