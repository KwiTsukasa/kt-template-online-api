import { filter, firstValueFrom, take } from 'rxjs';
import { NetworkManagementEventStreamService } from '../../../src/modules/admin/platform-config/network-management/network-management-event-stream.service';

describe('NetworkManagementEventStreamService', () => {
  it('fans out committed MQTT changes and replays only events after the cursor', async () => {
    const service = new NetworkManagementEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 5,
    });
    const liveEvent = firstValueFrom(
      service.stream().pipe(
        filter((event) => event.type === 'network-state-changed'),
        take(1),
      ),
    );

    const first = service.publishCommitted('reported');
    await expect(liveEvent).resolves.toEqual(first);
    const second = service.publishCommitted('status');

    await expect(
      firstValueFrom(service.stream(first.id).pipe(take(1))),
    ).resolves.toEqual(second);
  });

  it('requests one snapshot for an unknown replay cursor', async () => {
    const service = new NetworkManagementEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 1,
    });
    const latest = service.publishCommitted('events');

    const event = await firstValueFrom(
      service.stream('missing-event').pipe(take(1)),
    );

    expect(event).toMatchObject({ type: 'snapshot-required' });
    expect(event.id).toBe(latest.id);
  });

  it('keeps heartbeat on the latest committed replay cursor', async () => {
    jest.useFakeTimers();
    try {
      const service = new NetworkManagementEventStreamService({
        heartbeatMs: 1_000,
        replayLimit: 1,
      });
      const latest = service.publishCommitted('status');
      const heartbeat = firstValueFrom(
        service.stream(latest.id).pipe(
          filter((event) => event.type === 'heartbeat'),
          take(1),
        ),
      );

      jest.advanceTimersByTime(1_000);
      await Promise.resolve();

      const event = await heartbeat;
      expect(event).toMatchObject({ type: 'heartbeat' });
      expect(event.id).toBe(latest.id);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses an explicit empty heartbeat cursor before any state event', async () => {
    jest.useFakeTimers();
    try {
      const service = new NetworkManagementEventStreamService({
        heartbeatMs: 1_000,
        replayLimit: 1,
      });
      const heartbeat = firstValueFrom(
        service.stream().pipe(
          filter((event) => event.type === 'heartbeat'),
          take(1),
        ),
      );

      jest.advanceTimersByTime(1_000);
      await Promise.resolve();

      await expect(heartbeat).resolves.toMatchObject({
        id: '',
        type: 'heartbeat',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
