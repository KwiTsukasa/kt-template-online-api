import { EnvironmentDashboardSelfCheckService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-self-check.service';

describe('EnvironmentDashboardSelfCheckService', () => {
  it('publishes readonly evidence and forces a fresh dashboard snapshot', async () => {
    const dashboardService = {
      getDashboard: jest.fn(async () => ({
        actions: [],
        events: [],
        generatedAt: '2026-06-18T08:00:00.000Z',
        refreshedAt: '2026-06-18T08:00:00.000Z',
        sites: [],
        summary: { totalSignals: 0 },
        topology: { edges: [], nodes: [] },
      })),
    };
    const eventBus = {
      publish: jest.fn(async () => undefined),
    };
    const service = new EnvironmentDashboardSelfCheckService(
      dashboardService as any,
      eventBus as any,
    );

    await service.runSelfCheck();

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'local-dev',
        sourceKind: 'local',
      }),
    );
    expect(dashboardService.getDashboard).toHaveBeenCalledWith({
      forceRefresh: true,
    });
  });
});
