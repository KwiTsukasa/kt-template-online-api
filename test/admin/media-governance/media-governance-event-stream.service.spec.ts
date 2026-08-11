import { filter, firstValueFrom, take } from 'rxjs';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/media-governance-event-stream.service';

describe('MediaGovernanceEventStreamService', () => {
  it('publishes semantic task events and resumes after the exact cursor', async () => {
    const service = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 5,
    });
    const live = firstValueFrom(
      service.stream().pipe(
        filter((event) => event.type === 'task-changed'),
        take(1),
      ),
    );
    const first = service.publishTaskChanged({
      changeType: 'created',
      revision: 1,
      taskId: 'media-task-01',
    });
    await expect(live).resolves.toEqual(first);
    const second = service.publishTaskChanged({
      changeType: 'source-updated',
      revision: 2,
      taskId: 'media-task-01',
    });

    await expect(
      firstValueFrom(service.stream(first.id).pipe(take(1))),
    ).resolves.toEqual(second);
  });

  it('requires an authoritative snapshot after an unknown cursor', async () => {
    const service = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 1,
    });
    const latest = service.publishTaskChanged({
      changeType: 'created',
      revision: 1,
      taskId: 'media-task-01',
    });
    const event = await firstValueFrom(
      service.stream('missing-cursor').pipe(take(1)),
    );

    expect(event).toMatchObject({
      data: { message: 'snapshot-required' },
      id: latest.id,
      type: 'snapshot-required',
    });
  });

  it('keeps heartbeat on the latest semantic cursor', async () => {
    jest.useFakeTimers();
    try {
      const service = new MediaGovernanceEventStreamService({
        heartbeatMs: 1_000,
        replayLimit: 1,
      });
      const latest = service.publishTaskChanged({
        changeType: 'created',
        revision: 1,
        taskId: 'media-task-01',
      });
      const heartbeat = firstValueFrom(
        service.stream(latest.id).pipe(
          filter((event) => event.type === 'heartbeat'),
          take(1),
        ),
      );
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();

      await expect(heartbeat).resolves.toMatchObject({
        id: latest.id,
        type: 'heartbeat',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
