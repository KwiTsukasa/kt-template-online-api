import { EnvironmentDashboardCacheService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-cache.service';
import type { EnvironmentDashboardResponse } from '../../../../src/modules/admin/platform-config/environment-dashboard/domain/environment-dashboard.types';

const dashboard: EnvironmentDashboardResponse = {
  actions: [],
  events: [],
  generatedAt: '2026-06-18T08:00:00.000Z',
  refreshedAt: '2026-06-18T08:00:00.000Z',
  sites: [
    {
      id: 'local-dev',
      label: 'Local Dev',
      nodes: [
        {
          id: 'local-dev-api',
          label: 'Local API',
          services: [
            {
              id: 'local-api',
              label: 'API Runtime',
              signals: [
                {
                  evidence: [],
                  id: 'local-api-process',
                  label: 'API Process',
                  sourceKind: 'live',
                  status: 'ok',
                  summary: 'API process is reachable',
                },
              ],
              status: 'ok',
            },
          ],
          status: 'ok',
        },
      ],
      status: 'online',
    },
  ],
  summary: {
    byStatus: {
      blocked: 0,
      degraded: 0,
      down: 0,
      isolated: 0,
      ok: 1,
      unknown: 0,
      unwired: 0,
    },
    ok: 1,
    totalSignals: 1,
  },
  topology: { edges: [], nodes: [] },
};

describe('EnvironmentDashboardCacheService', () => {
  it('caches successful snapshots and marks reused live signals as cached', async () => {
    const cache = new EnvironmentDashboardCacheService({ ttlMs: 60_000 });
    const factory = jest.fn(async () => dashboard);

    await cache.getOrCreate(factory);
    const cached = await cache.getOrCreate(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(
      cached.sites[0].nodes[0].services[0].signals[0].sourceKind,
    ).toBe('cached');
    expect(cached.generatedAt).toBe(dashboard.generatedAt);
  });

  it('invalidates cached snapshots after a fresh event arrives', async () => {
    const cache = new EnvironmentDashboardCacheService({ ttlMs: 60_000 });
    const factory = jest
      .fn()
      .mockResolvedValueOnce(dashboard)
      .mockResolvedValueOnce({
        ...dashboard,
        generatedAt: '2026-06-18T08:01:00.000Z',
      });

    await cache.getOrCreate(factory);
    cache.invalidate();
    const refreshed = await cache.getOrCreate(factory);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(refreshed.generatedAt).toBe('2026-06-18T08:01:00.000Z');
  });

  it('does not turn failed collectors into cached green snapshots', async () => {
    const cache = new EnvironmentDashboardCacheService({ ttlMs: 60_000 });

    await expect(
      cache.getOrCreate(async () => {
        throw new Error('collector failed');
      }),
    ).rejects.toThrow('collector failed');

    await expect(cache.getOrCreate(async () => dashboard)).resolves.toEqual(
      dashboard,
    );
  });
});
