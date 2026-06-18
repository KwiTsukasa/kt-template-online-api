import {
  countSignals,
  mapSiteStatus,
  normalizeObservedAt,
  pickWorstHealthStatus,
} from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-status.mapper';

describe('environment dashboard status mapper', () => {
  it('uses blocked as the strongest signal', () => {
    expect(pickWorstHealthStatus(['ok', 'down', 'blocked'])).toBe('blocked');
  });

  it('keeps unwired integrations visible without marking a site healthy', () => {
    expect(mapSiteStatus(['ok', 'unwired'])).toBe('unknown');
  });

  it('marks isolated remote sites separately from ordinary degradation', () => {
    expect(mapSiteStatus(['ok', 'isolated'])).toBe('isolated');
  });

  it('counts all nested service signals', () => {
    expect(
      countSignals([
        {
          id: 'local-dev',
          label: 'Local Dev',
          status: 'online',
          nodes: [
            {
              id: 'local-dev-api',
              label: 'API',
              services: [
                {
                  id: 'local-dev-api-service',
                  label: 'API Service',
                  status: 'ok',
                  signals: [
                    {
                      id: 'runtime',
                      label: 'Runtime',
                      status: 'ok',
                      sourceKind: 'live',
                      summary: 'ready',
                      evidence: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual({
      blocked: 0,
      degraded: 0,
      down: 0,
      isolated: 0,
      ok: 1,
      unknown: 0,
      unwired: 0,
    });
  });

  it('normalizes dates into ISO strings for evidence timestamps', () => {
    expect(normalizeObservedAt(new Date('2026-06-18T00:00:00.000Z'))).toBe(
      '2026-06-18T00:00:00.000Z',
    );
  });
});
