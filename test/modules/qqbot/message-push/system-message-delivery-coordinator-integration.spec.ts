import type { DataSource, EntityManager } from 'typeorm';
import { KtDateTime } from '../../../../src/common';
import { SystemMessageDeliveryCoordinatorService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-delivery-coordinator.service';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const TCP_SOURCE_KEY = 'network.tcp.natmap-endpoint-changed';
const NOW = new Date('2026-07-24T03:04:05.000Z');

type CoordinatorStore = {
  deliveries: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
};

type CoordinatorHarness = {
  coordinator: SystemMessageDeliveryCoordinatorService;
  failUpdate: (error: Error | null) => void;
  operations: string[];
  requestDrain: jest.SpyInstance<void, []>;
  store: CoordinatorStore;
  transaction: jest.Mock;
};

function cloneStore(store: CoordinatorStore): CoordinatorStore {
  return structuredClone(store);
}

function inValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const values = (value as { _value?: unknown })._value;
  return Array.isArray(values) ? values : [];
}

function createCoordinatorHarness(): CoordinatorHarness {
  const store: CoordinatorStore = {
    deliveries: [
      {
        id: 'delivery-match',
        messageEventId: 'event-match',
        nextAttemptAt: 'future-match',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-match',
      },
      {
        id: 'delivery-old-address',
        messageEventId: 'event-old-address',
        nextAttemptAt: 'future-old',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-match',
      },
      {
        id: 'delivery-pending',
        messageEventId: 'event-match',
        nextAttemptAt: 'future-pending',
        status: 'pending',
        subscriptionId: 'subscription-match',
      },
      {
        id: 'delivery-inactive-subscription',
        messageEventId: 'event-match',
        nextAttemptAt: 'future-inactive',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-disabled',
      },
      {
        id: 'delivery-numeric-config',
        messageEventId: 'event-match',
        nextAttemptAt: 'future-numeric',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-numeric',
      },
      {
        id: 'delivery-other-source',
        messageEventId: 'event-other-source',
        nextAttemptAt: 'future-source',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-match',
      },
      {
        id: 'delivery-tcp-match',
        messageEventId: 'event-tcp-match',
        nextAttemptAt: 'future-tcp-match',
        status: 'waiting_ddns',
        subscriptionId: 'subscription-tcp-match',
      },
    ],
    events: [
      {
        id: 'event-match',
        payload: { publicIpv4: '8.8.8.8' },
        sourceKey: SOURCE_KEY,
      },
      {
        id: 'event-old-address',
        payload: { publicIpv4: '1.1.1.1' },
        sourceKey: SOURCE_KEY,
      },
      {
        id: 'event-other-source',
        payload: { publicIpv4: '8.8.8.8' },
        sourceKey: 'other.source',
      },
      {
        id: 'event-numeric-address',
        payload: { publicIpv4: 8_888 },
        sourceKey: SOURCE_KEY,
      },
      {
        id: 'event-tcp-match',
        payload: { publicIpv4: '8.8.8.8' },
        sourceKey: TCP_SOURCE_KEY,
      },
    ],
    subscriptions: [
      {
        enabled: true,
        id: 'subscription-match',
        isDeleted: false,
        sourceConfig: { ddnsRecordId: '9007199254740993' },
        sourceKey: SOURCE_KEY,
      },
      {
        enabled: true,
        id: 'subscription-tcp-match',
        isDeleted: false,
        sourceConfig: { ddnsRecordId: '9007199254740993' },
        sourceKey: TCP_SOURCE_KEY,
      },
      {
        enabled: false,
        id: 'subscription-disabled',
        isDeleted: false,
        sourceConfig: { ddnsRecordId: '9007199254740993' },
        sourceKey: SOURCE_KEY,
      },
      {
        enabled: true,
        id: 'subscription-numeric',
        isDeleted: false,
        sourceConfig: { ddnsRecordId: 9_007_199_254_740_993 },
        sourceKey: SOURCE_KEY,
      },
      {
        enabled: true,
        id: 'subscription-wrong',
        isDeleted: false,
        sourceConfig: { ddnsRecordId: 'other' },
        sourceKey: SOURCE_KEY,
      },
      {
        enabled: true,
        id: 'subscription-deleted',
        isDeleted: true,
        sourceConfig: { ddnsRecordId: '9007199254740993' },
        sourceKey: SOURCE_KEY,
      },
    ],
  };
  const operations: string[] = [];
  let updateFailure: Error | null = null;
  const transaction = jest.fn(
    async (work: (manager: EntityManager) => Promise<unknown>) => {
      operations.push('transaction:start');
      const draft = cloneStore(store);
      const manager = {
        getRepository: (entity: unknown) => {
          if (entity === QqbotMessageSubscription) {
            return {
              find: async ({ where }: { where: Record<string, unknown> }) =>
                draft.subscriptions.filter((row) =>
                  Object.entries(where).every(
                    ([key, value]) => row[key] === value,
                  ),
                ),
            };
          }
          if (entity === QqbotMessageEvent) {
            return {
              find: async ({ where }: { where: Record<string, unknown> }) =>
                draft.events.filter((row) =>
                  Object.entries(where).every(
                    ([key, value]) => row[key] === value,
                  ),
                ),
            };
          }
          if (entity === QqbotMessageDelivery) {
            return {
              update: async (
                where: Record<string, unknown>,
                patch: Record<string, unknown>,
              ) => {
                operations.push('delivery:update');
                if (updateFailure) throw updateFailure;
                const eventIds = inValues(where.messageEventId);
                const subscriptionIds = inValues(where.subscriptionId);
                let affected = 0;
                draft.deliveries.forEach((delivery) => {
                  if (
                    eventIds.includes(delivery.messageEventId) &&
                    subscriptionIds.includes(delivery.subscriptionId) &&
                    (where.status === undefined ||
                      delivery.status === where.status)
                  ) {
                    Object.assign(delivery, patch);
                    affected += 1;
                  }
                });
                return { affected };
              },
            };
          }
          throw new Error('unexpected coordinator repository');
        },
      } as unknown as EntityManager;
      const result = await work(manager);
      store.deliveries = draft.deliveries;
      store.events = draft.events;
      store.subscriptions = draft.subscriptions;
      operations.push('transaction:commit');
      return result;
    },
  );
  const coordinator = new SystemMessageDeliveryCoordinatorService(
    { transaction } as unknown as DataSource,
    { runOnce: jest.fn().mockResolvedValue(0) } as never,
    { runOnce: jest.fn().mockResolvedValue(0) } as never,
  );
  const requestDrain = jest
    .spyOn(coordinator, 'requestDrain')
    .mockImplementation(() => {
      operations.push('drain');
    });
  return {
    coordinator,
    failUpdate: (error) => {
      updateFailure = error;
    },
    operations,
    requestDrain,
    store,
    transaction,
  };
}

describe('SystemMessageDeliveryCoordinatorService DDNS integration', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires an exact non-empty string DDNS ID and IPv4 address', async () => {
    const harness = createCoordinatorHarness();

    for (const input of [
      { appliedAddress: '8.8.8.8', ddnsRecordId: 9_007_199_254_740_993 },
      { appliedAddress: '8.8.8.8', ddnsRecordId: '' },
      { appliedAddress: 'not-an-ip', ddnsRecordId: '9007199254740993' },
      { appliedAddress: '::1', ddnsRecordId: '9007199254740993' },
      { appliedAddress: 8_888, ddnsRecordId: '9007199254740993' },
    ]) {
      await harness.coordinator.notifyDdnsSynced(input as never);
    }

    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.requestDrain).not.toHaveBeenCalled();
  });

  it('advances only exact active-subscription and address-relevant waiting rows after commit', async () => {
    const harness = createCoordinatorHarness();
    const before = cloneStore(harness.store);

    await harness.coordinator.notifyDdnsSynced({
      appliedAddress: '8.8.8.8',
      ddnsRecordId: '9007199254740993',
    });

    expect(harness.store.deliveries).toEqual(
      before.deliveries.map((delivery) =>
        delivery.id === 'delivery-match' || delivery.id === 'delivery-tcp-match'
          ? { ...delivery, nextAttemptAt: new KtDateTime(NOW) }
          : delivery,
      ),
    );
    expect(harness.operations).toEqual([
      'transaction:start',
      'delivery:update',
      'delivery:update',
      'transaction:commit',
      'drain',
    ]);
    expect(harness.requestDrain).toHaveBeenCalledTimes(1);
  });

  it('keeps the write status-fenced and does not drain when the update advances zero rows', async () => {
    const harness = createCoordinatorHarness();
    harness.store.deliveries.find(
      (delivery) => delivery.id === 'delivery-match',
    )!.status = 'processing';
    harness.store.deliveries.find(
      (delivery) => delivery.id === 'delivery-tcp-match',
    )!.status = 'processing';
    const before = cloneStore(harness.store);

    await harness.coordinator.notifyDdnsSynced({
      appliedAddress: '8.8.8.8',
      ddnsRecordId: '9007199254740993',
    });

    expect(harness.store).toEqual(before);
    expect(harness.requestDrain).not.toHaveBeenCalled();
  });

  it('discards transaction drafts and never drains after an update failure', async () => {
    const harness = createCoordinatorHarness();
    const before = cloneStore(harness.store);
    harness.failUpdate(new Error('delivery update failed'));

    await expect(
      harness.coordinator.notifyDdnsSynced({
        appliedAddress: '8.8.8.8',
        ddnsRecordId: '9007199254740993',
      }),
    ).rejects.toThrow('delivery update failed');

    expect(harness.store).toEqual(before);
    expect(harness.requestDrain).not.toHaveBeenCalled();
    expect(harness.operations).not.toContain('transaction:commit');
  });

  it('does not query or drain after coordinator destruction', async () => {
    const harness = createCoordinatorHarness();
    await harness.coordinator.onModuleDestroy();

    await harness.coordinator.notifyDdnsSynced({
      appliedAddress: '8.8.8.8',
      ddnsRecordId: '9007199254740993',
    });

    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.requestDrain).not.toHaveBeenCalled();
  });
});
