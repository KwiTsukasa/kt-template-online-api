import { take, toArray } from 'rxjs';
import { EnvironmentEventMaterializer } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event.materializer';
import { EnvironmentEventStreamService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event-stream.service';
import { EnvironmentEventBusService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/event/environment-event-bus.service';

describe('EnvironmentEventStreamService', () => {
  it('emits materialized bus events to SSE subscribers', async () => {
    const bus = new EnvironmentEventBusService({ mode: 'local' });
    const materializer = new EnvironmentEventMaterializer(undefined, 5);
    const stream = new EnvironmentEventStreamService(bus, materializer, {
      heartbeatMs: 60_000,
      replayLimit: 5,
    });

    const received = stream.stream().pipe(take(1), toArray()).toPromise();
    await bus.publish({
      eventId: 'evt-1',
      observedAt: '2026-06-18T08:00:00.000Z',
      severity: 'degraded',
      siteId: 'nas-prod',
      sourceKind: 'mqtt',
      summary: 'NapCat degraded',
      topic: 'kt/env/nas-prod/napcat/runtime/event',
    });

    await expect(received).resolves.toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ summary: 'NapCat degraded' }),
        id: 'evt-1',
        type: 'environment-event',
      }),
    ]);
  });

  it('emits snapshot-required when Last-Event-ID is outside replay window', async () => {
    const bus = new EnvironmentEventBusService({ mode: 'local' });
    const materializer = new EnvironmentEventMaterializer(undefined, 1);
    const stream = new EnvironmentEventStreamService(bus, materializer, {
      heartbeatMs: 60_000,
      replayLimit: 1,
    });

    await bus.publish({
      eventId: 'evt-current',
      observedAt: '2026-06-18T08:00:00.000Z',
      severity: 'ok',
      siteId: 'local-dev',
      sourceKind: 'local',
      summary: 'current event',
      topic: 'kt/env/local-dev/api/event',
    });

    const first = await stream.stream('evt-missing').pipe(take(1)).toPromise();

    expect(first).toMatchObject({
      type: 'snapshot-required',
    });
  });
});
