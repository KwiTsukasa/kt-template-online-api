import type { EntityManager, Repository } from 'typeorm';
import { SystemMessageEventStagerService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-event-stager.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';

function createRegistry() {
  const registry = new SystemMessageSourceRegistry();
  const validateEventPayload = jest.fn((payload: Record<string, unknown>) => ({
    ...payload,
    normalized: true,
  }));
  registry.register({
    definition: {
      description: '测试来源',
      displayName: '测试来源',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [],
      variables: [],
      version: 1,
    },
    eventResourceKey: jest.fn(),
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(),
    subscriptionResourceKey: jest.fn(),
    validateEventPayload,
  });
  return { registry, validateEventPayload };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'endpoint-event-1',
    occurredAt: '2026-07-24T00:00:00.000Z',
    payload: { currentPort: 38213 },
    resourceKey: '100',
    sourceKey: SOURCE_KEY,
    ...overrides,
  };
}

function createManager(events: QqbotMessageEvent[] = [], saveError?: unknown) {
  const repository = {
    create: jest.fn((value) => Object.assign(new QqbotMessageEvent(), value)),
    findOne: jest.fn(
      async ({ where: { eventId } }) =>
        events.find((event) => event.eventId === eventId) ?? null,
    ),
    save: jest.fn(async (event) => {
      if (saveError) throw saveError;
      events.push(event);
      return event;
    }),
  } as unknown as jest.Mocked<Repository<QqbotMessageEvent>>;
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessageEvent) return repository;
      throw new Error('unexpected repository');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  return { events, manager, repository };
}

describe('SystemMessageEventStagerService', () => {
  it('validates, normalizes, and accepts a new event through the supplied manager', async () => {
    const { registry, validateEventPayload } = createRegistry();
    const { events, manager, repository } = createManager();
    const service = new SystemMessageEventStagerService(registry);

    await expect(service.stage(manager, input())).resolves.toBe('accepted');

    expect(validateEventPayload).toHaveBeenCalledWith({ currentPort: 38213 });
    expect(manager.getRepository).toHaveBeenCalledWith(QqbotMessageEvent);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'endpoint-event-1',
        fanoutAttemptCount: 0,
        fanoutLeaseUntil: null,
        fanoutStatus: 'accepted',
        lastErrorCode: null,
        lastErrorMessage: null,
        payload: { currentPort: 38213, normalized: true },
        resourceKey: '100',
        sourceKey: SOURCE_KEY,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt).toBeInstanceOf(Date);
    expect(events[0].nextFanoutAt).toBeInstanceOf(Date);
  });

  it('returns duplicate without saving when the event already exists', async () => {
    const { registry } = createRegistry();
    const { manager, repository } = createManager([
      Object.assign(new QqbotMessageEvent(), { eventId: 'endpoint-event-1' }),
    ]);
    const service = new SystemMessageEventStagerService(registry);

    await expect(service.stage(manager, input())).resolves.toBe('duplicate');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([{ code: 'ER_DUP_ENTRY' }, { errno: 1062 }])(
    'treats a MySQL save race with %o as duplicate',
    async (error) => {
      const { registry } = createRegistry();
      const { manager } = createManager([], error);
      const service = new SystemMessageEventStagerService(registry);

      await expect(service.stage(manager, input())).resolves.toBe('duplicate');
    },
  );

  it('rethrows a non-duplicate save error', async () => {
    const { registry } = createRegistry();
    const failure = new Error('database unavailable');
    const { manager } = createManager([], failure);
    const service = new SystemMessageEventStagerService(registry);

    await expect(service.stage(manager, input())).rejects.toBe(failure);
  });
});
