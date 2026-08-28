import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';
import { NasProdSignalCollector } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/collectors/nas-prod-signal.collector';

describe('NasProdSignalCollector', () => {
  it('projects only API Runtime, Home Assistant, and QQBot from live sources', async () => {
    const homeAssistantAdapter = {
      inspect: jest.fn(async () => ({
        evidence: [],
        id: 'home-assistant-api',
        label: 'Home Assistant API',
        sourceKind: 'live',
        status: 'ok',
        summary: 'Home Assistant API 可用',
      })),
    };
    const collector = new NasProdSignalCollector(
      {
        getRuntimeHealth: jest.fn(() => ({
          checkedAt: '2026-08-28T08:00:00.000Z',
          checks: [
            {
              critical: true,
              message: 'process answered',
              name: 'process',
              status: 'live',
            },
            {
              critical: false,
              message: 'optional key missing',
              name: 'config:optional',
              status: 'degraded',
            },
          ],
          service: 'kt-template-online-api',
          status: 'degraded',
        })),
      } as any,
      {
        summary: jest.fn(async () => ({
          accountTotal: 2,
          onlineTotal: 2,
        })),
      } as any,
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_HOME_ASSISTANT_TOKEN: 'ha-secret',
        ENV_DASHBOARD_HOME_ASSISTANT_URL: 'http://home-assistant.example',
      }),
      homeAssistantAdapter as any,
    );

    const site = await collector.collect({
      observedAt: '2026-08-28T08:00:00.000Z',
    });
    const services = site.nodes.flatMap((node) => node.services);

    expect(site).toMatchObject({
      id: 'nas-prod',
      label: 'NAS',
      status: 'online',
    });
    expect(services.map((service) => service.id)).toEqual([
      'nas-api',
      'home-assistant',
      'bot-core',
    ]);
    expect(services.map((service) => service.status)).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
    expect(services.find((service) => service.id === 'bot-core')?.label).toBe(
      'QQBot',
    );
    expect(homeAssistantAdapter.inspect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(site)).not.toContain('ha-secret');
  });

  it('keeps a zero-online QQBot result degraded without creating placeholder services', async () => {
    const collector = new NasProdSignalCollector(
      {
        getRuntimeHealth: jest.fn(() => ({
          checkedAt: '2026-08-28T08:00:00.000Z',
          checks: [
            {
              critical: true,
              message: 'process answered',
              name: 'process',
              status: 'live',
            },
          ],
          service: 'kt-template-online-api',
          status: 'live',
        })),
      } as any,
      {
        summary: jest.fn(async () => ({
          accountTotal: 2,
          onlineTotal: 0,
        })),
      } as any,
      new EnvironmentDashboardConfigService({}),
    );

    const site = await collector.collect();
    const services = site.nodes[0]?.services || [];

    expect(services.map((service) => service.id)).toEqual([
      'nas-api',
      'home-assistant',
      'bot-core',
    ]);
    expect(services.find((service) => service.id === 'bot-core')?.status).toBe(
      'degraded',
    );
    expect(
      services.find((service) => service.id === 'home-assistant')?.status,
    ).toBe('unwired');
  });
});
