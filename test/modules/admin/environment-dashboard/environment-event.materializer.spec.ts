import { EnvironmentEventMaterializer } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event.materializer';

describe('environment event materializer', () => {
  it('rejects expired retained ok signals so they cannot create green status', () => {
    const cache = { invalidate: jest.fn() };
    const materializer = new EnvironmentEventMaterializer(cache);

    const event = materializer.materialize(
      {
        eventId: 'evt-old-retained',
        expiresAt: '2026-06-18T00:00:00.000Z',
        observedAt: '2026-06-17T23:00:00.000Z',
        retained: true,
        severity: 'ok',
        siteId: 'nas-prod',
        sourceKind: 'mqtt',
        summary: 'old retained healthy signal',
        topic: 'kt/env/signal/nas-prod/k8s/api',
      },
      new Date('2026-06-18T01:00:00.000Z'),
    );

    expect(event?.severity).toBe('unknown');
    expect(event?.summary).toContain('已过期');
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates dashboard cache for fresh signal events and appends recent events', () => {
    const cache = { invalidate: jest.fn() };
    const materializer = new EnvironmentEventMaterializer(cache);

    const event = materializer.materialize(
      {
        eventId: 'evt-fresh',
        expiresAt: '2026-06-18T01:05:00.000Z',
        observedAt: '2026-06-18T01:00:00.000Z',
        retained: true,
        severity: 'degraded',
        signalId: 'api-pod',
        siteId: 'nas-prod',
        sourceKind: 'mqtt',
        summary: 'api pod restart count increased',
        topic: 'kt/env/signal/nas-prod/k8s/api',
      },
      new Date('2026-06-18T01:01:00.000Z'),
    );

    expect(event?.id).toBe('evt-fresh');
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(materializer.getRecentEvents()).toEqual([event]);
  });
});
