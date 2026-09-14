import type { DataSource } from 'typeorm';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import type { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import {
  MediaGovernanceRssItemEntity,
  MediaGovernanceRssSubscriptionEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';

type RssInternals = {
  fetchFeed: (url: string) => Promise<string>;
  pollingSubscriptions: Set<string>;
  pollSubscription: (
    subscription: MediaGovernanceRssSubscriptionEntity,
    manual: boolean,
  ) => Promise<unknown>;
  publishCatalogChanged: (
    seriesId: string,
    taskIds: string[],
    change: string,
  ) => Promise<void>;
};

/**
 * 构造只允许访问 RSS 两张表的事务夹具，模拟删除与过期轮询竞争。
 * @param status - 初始订阅轮询状态。
 * @returns 目录服务、订阅快照、事务和仅限 RSS 的仓库替身。
 */
function createFixture(status = 'disabled') {
  const subscription = {
    id: 'rss-old',
    seriesId: 'series-kept',
    revision: 7,
    status,
    enabled: false,
    pollIntervalMinutes: 15,
    feedUrl: 'https://example.test/rss',
  } as MediaGovernanceRssSubscriptionEntity;
  const repository = {
    findOne: jest.fn().mockResolvedValue(subscription),
    findOneBy: jest.fn().mockResolvedValue(subscription),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn(),
  };
  const items = { delete: jest.fn().mockResolvedValue({ affected: 3 }) };
  const getRepository = jest.fn((entity) => {
    if (entity === MediaGovernanceRssSubscriptionEntity) return repository;
    if (entity === MediaGovernanceRssItemEntity) return items;
    throw new Error(
      'RSS deletion must not access Task, source, episode or binding repositories',
    );
  });
  const transaction = jest.fn(async (callback) => callback({ getRepository }));
  const service = new MediaGovernanceCatalogService(
    { getRepository, transaction } as unknown as DataSource,
    {} as MediaGovernanceService,
  );
  const internals = service as unknown as RssInternals;
  const publish = jest
    .spyOn(internals, 'publishCatalogChanged')
    .mockResolvedValue();
  return {
    service,
    subscription,
    repository,
    items,
    transaction,
    internals,
    publish,
  };
}

describe('RSS subscription deletion', () => {
  it.each(['disabled', 'idle', 'error'])(
    'deletes %s RSS and items while preserving existing tasks',
    async (status) => {
      const { service, repository, items, publish } = createFixture(status);
      await expect(
        service.deleteRssSubscription('rss-old', 7),
      ).resolves.toEqual({
        deleted: true,
        seriesId: 'series-kept',
        subscriptionId: 'rss-old',
      });
      expect(repository.findOne).toHaveBeenCalledWith({
        lock: { mode: 'pessimistic_write' },
        where: { id: 'rss-old' },
      });
      expect(items.delete).toHaveBeenCalledWith({ subscriptionId: 'rss-old' });
      expect(repository.delete).toHaveBeenCalledWith({ id: 'rss-old' });
      expect(items.delete.mock.invocationCallOrder[0]).toBeLessThan(
        repository.delete.mock.invocationCallOrder[0],
      );
      expect(publish).toHaveBeenCalledWith('series-kept', [], 'updated');
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('rejects stale revisions before deleting any data', async () => {
    const { service, repository, items, publish } = createFixture();
    await expect(
      service.deleteRssSubscription('rss-old', 6),
    ).rejects.toMatchObject({ status: 409 });
    expect(items.delete).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns 404 for a deleted or unknown subscription', async () => {
    const { service, repository, items } = createFixture();
    repository.findOne.mockResolvedValue(null);
    await expect(
      service.deleteRssSubscription('rss-old', 7),
    ).rejects.toMatchObject({ status: 404 });
    expect(items.delete).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid revision %s without a transaction',
    async (revision) => {
      const { service, transaction } = createFixture();
      await expect(
        service.deleteRssSubscription('rss-old', revision),
      ).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['database', 'in-process'])(
    'rejects a poll owned by %s before deletion',
    async (owner) => {
      const { service, subscription, internals, items } = createFixture();
      if (owner === 'database') subscription.status = 'polling';
      else internals.pollingSubscriptions.add(subscription.id);
      await expect(
        service.deleteRssSubscription('rss-old', 7),
      ).rejects.toMatchObject({ status: 409 });
      expect(items.delete).not.toHaveBeenCalled();
    },
  );

  it('does not delete the subscription or publish success after item deletion fails', async () => {
    const { service, repository, items, publish } = createFixture();
    items.delete.mockRejectedValueOnce(new Error('transaction failure'));
    await expect(service.deleteRssSubscription('rss-old', 7)).rejects.toThrow(
      'transaction failure',
    );
    expect(repository.delete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('stops a queued stale poll after deletion instead of fetching or recreating the RSS', async () => {
    const { service, subscription, repository, internals } =
      createFixture('idle');
    const snapshot = { ...subscription, enabled: true };
    const fetchFeed = jest.spyOn(internals, 'fetchFeed');
    await service.deleteRssSubscription('rss-old', 7);
    repository.update.mockResolvedValueOnce({ affected: 0 });
    await expect(internals.pollSubscription(snapshot, false)).resolves.toEqual({
      createdTasks: 0,
      discovered: 0,
      ignored: 0,
      queued: 0,
    });
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(internals.pollingSubscriptions.size).toBe(0);
  });

  it('does not resurrect an RSS deleted after a state-change read', async () => {
    const { service, repository } = createFixture();
    repository.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      service.setRssSubscriptionState('rss-old', {
        enabled: true,
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('refuses to overwrite polling ownership through the state endpoint', async () => {
    const { service, repository } = createFixture('polling');
    await expect(
      service.setRssSubscriptionState('rss-old', {
        enabled: false,
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.update).not.toHaveBeenCalled();
  });
});
