import { filter, firstValueFrom, take } from 'rxjs';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';

function taskEvent(changeType: 'created' | 'source-updated', revision: number) {
  return {
    changeType,
    patchMode: 'full' as const,
    revision,
    runId: null,
    runSequence: null,
    summary: {
      agentPending: 0,
      attentionRequired: 0,
      blocked: 0,
      closed: 0,
      downloading: 0,
      evidenceDriftCount: 0,
      governing: 0,
      healthLabel: '正常',
      metadataAutoClosureRate: 0,
      mixedSubtitleSeasonCount: 0,
      stagingResidualCount: 0,
      stuckRunCount: 0,
      total: 1,
    },
    task: null,
    taskId: 'media-task-01',
    updatedAt: new Date().toISOString(),
  };
}

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
    const first = service.publishTaskChanged(taskEvent('created', 1));
    await expect(live).resolves.toEqual(first);
    const second = service.publishTaskChanged(taskEvent('source-updated', 2));

    await expect(
      firstValueFrom(service.stream(first.id).pipe(take(1))),
    ).resolves.toEqual(second);
  });

  it('notifies internal task subscribers and publishes replayable catalog cards', async () => {
    const service = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 5,
    });
    const subscriber = jest.fn();
    const unsubscribe = service.subscribeTaskChanged(subscriber);
    const taskChanged = service.publishTaskChanged(taskEvent('created', 1));
    await Promise.resolve();
    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'media-task-01' }),
    );
    unsubscribe();

    const catalog = service.publishCatalogChanged({
      changeType: 'created',
      revision: 1,
      series: {
        bindingCount: 2,
        boundEpisodeCount: 2,
        canonicalProvider: 'tmdb',
        canonicalProviderId: '100',
        coveragePercent: 100,
        createTime: new Date('2026-08-24T00:00:00.000Z'),
        episodeCount: 2,
        id: 'media-series-auto-01',
        mediaType: 'tv',
        originalTitle: null,
        releaseYear: 2026,
        revision: 1,
        rssCount: 0,
        rssTotalCount: 0,
        seasonCount: 1,
        seasonSummaries: [],
        status: 'active',
        taskCount: 1,
        title: '自动归类作品',
        updateTime: new Date('2026-08-24T00:00:00.000Z'),
      },
      seriesId: 'media-series-auto-01',
      taskId: 'media-task-01',
      taskIds: ['media-task-01'],
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(catalog).toMatchObject({
      data: {
        changeType: 'created',
        seriesId: 'media-series-auto-01',
        taskId: 'media-task-01',
      },
      type: 'catalog-changed',
    });
    await expect(
      firstValueFrom(service.stream(taskChanged.id).pipe(take(1))),
    ).resolves.toEqual(catalog);
  });

  it('requires an authoritative snapshot after an unknown cursor', async () => {
    const service = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
      replayLimit: 1,
    });
    const latest = service.publishTaskChanged(taskEvent('created', 1));
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
      const latest = service.publishTaskChanged(taskEvent('created', 1));
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
