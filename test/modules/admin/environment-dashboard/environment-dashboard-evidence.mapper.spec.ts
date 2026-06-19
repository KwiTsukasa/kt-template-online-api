import {
  cachedEvidence,
  errorEvidence,
  liveEvidence,
  unwiredEvidence,
} from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-evidence.mapper';

describe('environment dashboard evidence mapper', () => {
  it('creates live evidence with metadata and normalized timestamp', () => {
    expect(
      liveEvidence('jenkins', 'build #1 success', '2026-06-18T01:00:00Z', {
        buildNumber: 1,
      }),
    ).toEqual({
      metadata: { buildNumber: 1 },
      observedAt: '2026-06-18T01:00:00.000Z',
      source: 'jenkins',
      sourceKind: 'live',
      summary: 'build #1 success',
    });
  });

  it('keeps missing config visible as unwired evidence', () => {
    expect(
      unwiredEvidence('kubernetes', [
        'ENV_DASHBOARD_K8S_API_SERVER',
        'ENV_DASHBOARD_K8S_BEARER_TOKEN',
      ]),
    ).toMatchObject({
      metadata: {
        missingConfigKeys: [
          'ENV_DASHBOARD_K8S_API_SERVER',
          'ENV_DASHBOARD_K8S_BEARER_TOKEN',
        ],
      },
      source: 'kubernetes',
      sourceKind: 'unwired',
    });
  });

  it('serializes errors without leaking stack traces', () => {
    expect(errorEvidence('caddy', new Error('connect ECONNREFUSED'))).toEqual(
      expect.objectContaining({
        source: 'caddy',
        sourceKind: 'derived',
        summary: 'connect ECONNREFUSED',
      }),
    );
  });

  it('adds expiresAt to cached evidence so stale data cannot stay green forever', () => {
    expect(
      cachedEvidence(
        'mqtt',
        'retained signal',
        '2026-06-18T01:00:00Z',
        '2026-06-18T01:05:00Z',
      ),
    ).toMatchObject({
      expiresAt: '2026-06-18T01:05:00.000Z',
      observedAt: '2026-06-18T01:00:00.000Z',
      sourceKind: 'cached',
    });
  });
});
