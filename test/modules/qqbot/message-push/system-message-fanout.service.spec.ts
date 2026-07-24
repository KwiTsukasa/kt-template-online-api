import { KtDateTime } from '../../../../src/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
} from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { SystemMessageFanoutService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-fanout.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-template-renderer.service';
import { QqbotAccount } from '../../../../src/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_DDNS_RECHECK_MS,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_WINDOW_MS,
} from '../../../../src/modules/qqbot/core/application/message-push/system-message-runner.constants';

const NOW = new Date('2026-07-24T00:00:00.000Z');
const SOURCE_KEY = 'network.stun.mapping-port-changed';
const RESOURCE_KEY = '9007199254740993';

type Store = {
  accounts: QqbotAccount[];
  bindings: QqbotMessagePublishBinding[];
  deliveries: QqbotMessageDelivery[];
  events: QqbotMessageEvent[];
  subscriptions: QqbotMessageSubscription[];
  targets: QqbotMessagePublishTarget[];
  templates: QqbotMessageTemplate[];
};

type RecordedPredicate =
  | { brackets: RecordedPredicate[] }
  | { expression: string; parameters: object };

/** Builds a consistent current event whose payload preserves string Snowflake identity. */
function event(overrides: Partial<QqbotMessageEvent> = {}): QqbotMessageEvent {
  return Object.assign(new QqbotMessageEvent(), {
    fanoutAttemptCount: 0,
    fanoutLeaseUntil: null,
    fanoutStatus: 'accepted',
    id: '200',
    lastErrorCode: null,
    lastErrorMessage: null,
    nextFanoutAt: new KtDateTime(NOW),
    occurredAt: new KtDateTime(NOW),
    payload: { endpoint: 'pal.example.com:38213', portForwardId: RESOURCE_KEY },
    resourceKey: RESOURCE_KEY,
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

/** Builds an active strict JSON-matched subscription. */
function subscription(
  overrides: Partial<QqbotMessageSubscription> = {},
): QqbotMessageSubscription {
  return Object.assign(new QqbotMessageSubscription(), {
    enabled: true,
    id: '300',
    isDeleted: false,
    sourceConfig: { portForwardId: RESOURCE_KEY },
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

/** Builds an enabled account without relying on its runtime online state. */
function account(overrides: Partial<QqbotAccount> = {}): QqbotAccount {
  return Object.assign(new QqbotAccount(), {
    enabled: true,
    id: '400',
    isDeleted: false,
    selfId: 'bot-a',
    ...overrides,
  });
}

/** Builds an active account-scoped publishing binding. */
function binding(
  overrides: Partial<QqbotMessagePublishBinding> = {},
): QqbotMessagePublishBinding {
  return Object.assign(new QqbotMessagePublishBinding(), {
    accountId: '400',
    enabled: true,
    id: '500',
    isDeleted: false,
    selfId: 'bot-a',
    subscriptionId: '300',
    templateId: '600',
    ...overrides,
  });
}

/** Builds an active source-compatible literal template. */
function template(
  overrides: Partial<QqbotMessageTemplate> = {},
): QqbotMessageTemplate {
  return Object.assign(new QqbotMessageTemplate(), {
    content: 'endpoint=${{endpoint}}',
    enabled: true,
    id: '600',
    isDeleted: false,
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

/** Builds one active group/private target under a binding. */
function target(
  overrides: Partial<QqbotMessagePublishTarget> = {},
): QqbotMessagePublishTarget {
  return Object.assign(new QqbotMessagePublishTarget(), {
    bindingId: '500',
    enabled: true,
    id: '700',
    isDeleted: false,
    targetId: 'group-1',
    targetType: 'group',
    ...overrides,
  });
}

/** Builds a controllable source adapter while retaining a real source registry boundary. */
function sourceAdapter(): jest.Mocked<SystemMessageSourceAdapter> {
  return {
    definition: {
      description: 'test',
      displayName: 'test',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [],
      variables: [],
      version: 1,
    },
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(async (_input) => {
      void _input;
      return {
        reasonCode: null,
        status: 'ready' as const,
        variables: { endpoint: 'pal.example.com:38213' },
      };
    }),
    validateEventPayload: jest.fn(
      (payload) => payload as Record<string, boolean | null | number | string>,
    ),
  };
}

/** Clones transaction-visible rows while preserving Date objects and entity prototypes. */
function cloneStore(value: Store): Store {
  const clone = <T>(items: T[]) =>
    items.map((item) =>
      Object.assign(
        Object.create(Object.getPrototypeOf(item)),
        structuredClone(item),
      ),
    );
  return {
    accounts: clone(value.accounts),
    bindings: clone(value.bindings),
    deliveries: clone(value.deliveries),
    events: clone(value.events),
    subscriptions: clone(value.subscriptions),
    targets: clone(value.targets),
    templates: clone(value.templates),
  };
}

/** Matches the intentionally small TypeORM `where` subset used by the fan-out service. */
function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown> = {},
): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key];
    if (
      actual &&
      value &&
      typeof actual === 'object' &&
      typeof value === 'object' &&
      'getTime' in actual &&
      'getTime' in value &&
      typeof actual.getTime === 'function' &&
      typeof value.getTime === 'function'
    )
      return actual.getTime() === value.getTime();
    return actual === value;
  });
}

/** Creates a transaction-faithful in-memory persistence harness rather than fan-out logic. */
function setup(seed: Partial<Store> = {}) {
  let state: Store = {
    accounts: seed.accounts ?? [account()],
    bindings: seed.bindings ?? [binding()],
    deliveries: seed.deliveries ?? [],
    events: seed.events ?? [event()],
    subscriptions: seed.subscriptions ?? [subscription()],
    targets: seed.targets ?? [target()],
    templates: seed.templates ?? [template()],
  };
  const adapter = sourceAdapter();
  const registry = new SystemMessageSourceRegistry();
  registry.register(adapter);
  const query = {
    brackets: false,
    lock: '',
    onLocked: '',
    order: [] as string[],
    predicates: [] as RecordedPredicate[],
    take: 0,
  };
  const newerEventReads: Array<{
    lock: string;
    order: string[];
    predicates: RecordedPredicate[];
    take: number;
  }> = [];
  const transactions: string[] = [];
  const locked = new Set<string>();
  const activeClaimLocks = new Set<string>();
  const deliveryReadLocks: Array<null | string> = [];
  const savedDeliveryTargets: string[] = [];
  let deliverySequence = 1000;
  let duplicateRace: 'exact' | 'wrong' | null = null;
  const concurrentDeliveries: QqbotMessageDelivery[] = [];
  let failSubscription: null | string = null;
  let failDeliveryTarget: null | string = null;
  let pauseClaim: null | {
    entered: () => void;
    resume: Promise<void>;
  } = null;
  let pauseEventLock: null | {
    entered: () => void;
    resume: Promise<void>;
  } = null;

  /** Returns a repository facade bound to exactly one authoritative or transaction-local store. */
  const repository = (
    entity: unknown,
    store: Store,
    transactionLocks?: Set<string>,
  ) => {
    const rows = (entity === QqbotMessageEvent
      ? store.events
      : entity === QqbotMessageSubscription
        ? store.subscriptions
        : entity === QqbotMessagePublishBinding
          ? store.bindings
          : entity === QqbotAccount
            ? store.accounts
            : entity === QqbotMessageTemplate
              ? store.templates
              : entity === QqbotMessagePublishTarget
                ? store.targets
                : store.deliveries) as unknown as Array<
      Record<string, unknown>
    >;
    return {
      create: (input: object) =>
        Object.assign(new (entity as new () => object)(), input),
      createQueryBuilder: (alias = 'event') => {
        let builderLock = '';
        let queryNow: Date | null = null;
        const newerEventRead = {
          lock: '',
          order: [] as string[],
          predicates: [] as RecordedPredicate[],
          take: 0,
        };
        const newerEventParameters: Record<string, unknown> = {};
        /** Records the nested TypeORM predicate structure and its bound values. */
        const recordBrackets = (value: {
          whereFactory?: (where: {
            orWhere: (expression: unknown, parameters?: object) => void;
            where: (expression: unknown, parameters?: object) => void;
          }) => void;
        }): RecordedPredicate => {
          const predicates: RecordedPredicate[] = [];
          const recorder = {} as {
            orWhere: (expression: unknown, parameters?: object) => unknown;
            where: (expression: unknown, parameters?: object) => unknown;
          };
          const record = (expression: unknown, parameters: object = {}) => {
            if (typeof expression === 'string') {
              const now = (parameters as { now?: unknown }).now;
              if (now instanceof Date) queryNow = now;
              if (alias === 'newerEvent') {
                Object.assign(newerEventParameters, parameters);
              }
              predicates.push({ expression, parameters });
              return recorder;
            }
            predicates.push(
              recordBrackets(
                expression as {
                  whereFactory?: (where: {
                    orWhere: (value: unknown, values?: object) => void;
                    where: (value: unknown, values?: object) => void;
                  }) => void;
                },
              ),
            );
            return recorder;
          };
          recorder.orWhere = record;
          recorder.where = record;
          value.whereFactory?.(recorder);
          return { brackets: predicates };
        };
        const builder = {
          addOrderBy: (field: string) => {
            if (alias === 'newerEvent') newerEventRead.order.push(field);
            else query.order.push(field);
            return builder;
          },
          getOne: async () => {
            if (alias === 'newerEvent') {
              newerEventReads.push(structuredClone(newerEventRead));
              const sourceKey = newerEventParameters.sourceKey;
              const resourceKey = newerEventParameters.resourceKey;
              const occurredAt = newerEventParameters.occurredAt;
              const eventId = newerEventParameters.eventId;
              if (
                typeof sourceKey !== 'string' ||
                typeof resourceKey !== 'string' ||
                !occurredAt ||
                typeof (occurredAt as { getTime?: unknown }).getTime !==
                  'function' ||
                typeof eventId !== 'string'
              ) {
                return null;
              }
              const currentOccurredAt = (
                occurredAt as { getTime: () => number }
              ).getTime();
              return (
                store.events.find((candidate) => {
                  return (
                    candidate.sourceKey === sourceKey &&
                    candidate.resourceKey === resourceKey &&
                    (candidate.occurredAt.getTime() > currentOccurredAt ||
                      (candidate.occurredAt.getTime() === currentOccurredAt &&
                        BigInt(candidate.id) > BigInt(eventId)))
                  );
                }) ?? null
              );
            }
            const claimed =
              rows
                .filter((row) => {
                  const item = row as unknown as QqbotMessageEvent;
                  return (
                    ((item.fanoutStatus === 'accepted' ||
                      item.fanoutStatus === 'retry') &&
                      (item.nextFanoutAt === null ||
                        item.nextFanoutAt.getTime() <=
                          (queryNow ?? NOW).getTime())) ||
                    (item.fanoutStatus === 'processing' &&
                      !!item.fanoutLeaseUntil &&
                      item.fanoutLeaseUntil.getTime() <=
                        (queryNow ?? NOW).getTime())
                  );
                })
                .filter(
                  (row) =>
                    !locked.has((row as unknown as QqbotMessageEvent).id) &&
                    !activeClaimLocks.has(
                      (row as unknown as QqbotMessageEvent).id,
                    ),
                )
                .sort((left, right) => {
                  const a = left as unknown as QqbotMessageEvent;
                  const b = right as unknown as QqbotMessageEvent;
                  return (
                    a.occurredAt.getTime() - b.occurredAt.getTime() ||
                    (BigInt(a.id) < BigInt(b.id)
                      ? -1
                      : BigInt(a.id) > BigInt(b.id)
                        ? 1
                        : 0)
                  );
                })[0] ?? null;
            if (
              !claimed ||
              !pauseClaim ||
              builderLock !== 'pessimistic_write'
            ) {
              return claimed;
            }
            const id = (claimed as unknown as QqbotMessageEvent).id;
            activeClaimLocks.add(id);
            pauseClaim.entered();
            await pauseClaim.resume;
            activeClaimLocks.delete(id);
            return claimed;
          },
          orderBy: (field: string) => {
            if (alias === 'newerEvent') newerEventRead.order.push(field);
            else query.order.push(field);
            return builder;
          },
          setLock: (value: string) => {
            if (alias === 'newerEvent') newerEventRead.lock = value;
            else query.lock = value;
            builderLock = value;
            return builder;
          },
          setOnLocked: (value: string) => {
            query.onLocked = value;
            return builder;
          },
          take: (value: number) => {
            if (alias === 'newerEvent') newerEventRead.take = value;
            else query.take = value;
            return builder;
          },
          where: (value: unknown, parameters?: object) => {
            const predicates =
              alias === 'newerEvent'
                ? newerEventRead.predicates
                : query.predicates;
            if (typeof value === 'string') {
              predicates.push({
                expression: value,
                parameters: parameters ?? {},
              });
              Object.assign(newerEventParameters, parameters);
              return builder;
            }
            if (alias !== 'newerEvent') {
              query.brackets = value.constructor.name === 'Brackets';
            }
            predicates.push(
              recordBrackets(
                value as {
                  whereFactory?: (where: {
                    orWhere: (expression: unknown, parameters?: object) => void;
                    where: (expression: unknown, parameters?: object) => void;
                  }) => void;
                },
              ),
            );
            return builder;
          },
          andWhere: (value: unknown, parameters?: object) => {
            return builder.where(value, parameters);
          },
        };
        return builder;
      },
      find: async ({
        order,
        where,
      }: { order?: { id?: 'ASC' }; where?: Record<string, unknown> } = {}) => {
        const result = rows.filter((row) => matches(row, where));
        return order?.id
          ? result.sort((left, right) =>
              `${(left as { id: string }).id}`.localeCompare(
                `${(right as { id: string }).id}`,
              ),
            )
          : result;
      },
      findOne: async ({
        lock,
        where,
      }: {
        lock?: { mode: string };
        where: Record<string, unknown>;
      }) => {
        if (
          entity === QqbotMessageEvent &&
          lock?.mode === 'pessimistic_write'
        ) {
          const event = rows.find((row) => matches(row, where));
          if (!event) return null;
          const id = (event as unknown as QqbotMessageEvent).id;
          activeClaimLocks.add(id);
          transactionLocks?.add(id);
          if (pauseEventLock) {
            pauseEventLock.entered();
            await pauseEventLock.resume;
          }
          return event;
        }
        if (entity === QqbotMessageDelivery) {
          deliveryReadLocks.push(lock?.mode ?? null);
          const visible = lock ? [...rows, ...concurrentDeliveries] : rows;
          return (
            visible.find((row) =>
              matches(row as Record<string, unknown>, where),
            ) ?? null
          );
        }
        return rows.find((row) => matches(row, where)) ?? null;
      },
      save: async (item: Record<string, unknown>) => {
        if (
          entity === QqbotMessageDelivery &&
          failSubscription === item.bindingId
        )
          throw new Error('repository offline');
        if (entity === QqbotMessageDelivery) {
          const pair = rows.find((row) =>
            matches(row, {
              messageEventId: item.messageEventId,
              publishTargetId: item.publishTargetId,
            }),
          );
          if (!item.id && duplicateRace) {
            if (duplicateRace === 'exact') {
              concurrentDeliveries.push(
                Object.assign(new QqbotMessageDelivery(), item, {
                  id: 'race',
                }),
              );
            }
            duplicateRace = null;
            throw { errno: 1062 };
          }
          if (pair && pair !== item) throw { errno: 1062 };
          if (failDeliveryTarget === item.publishTargetId) {
            throw new Error('repository offline after delivery mutation');
          }
          if (!item.id) item.id = `${deliverySequence++}`;
        }
        const index = rows.findIndex(
          (row) => (row as { id?: string }).id === item.id,
        );
        if (index >= 0) Object.assign(rows[index] as object, item);
        else rows.push(item as never);
        if (entity === QqbotMessageDelivery) {
          savedDeliveryTargets.push(item.publishTargetId as string);
        }
        return item;
      },
      update: async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        const row = rows.find((candidate) => matches(candidate, where));
        if (!row) return { affected: 0 };
        Object.assign(row as object, values);
        return { affected: 1 };
      },
    };
  };
  const dataSource = {
    getRepository: (entity: unknown) => repository(entity, state),
    transaction: async (
      callback: (manager: {
        getRepository: (entity: unknown) => ReturnType<typeof repository>;
      }) => Promise<unknown>,
    ) => {
      const draft = cloneStore(state);
      const transactionLocks = new Set<string>();
      transactions.push('begin');
      try {
        const result = await callback({
          getRepository: (entity) =>
            repository(entity, draft, transactionLocks),
        });
        for (const delivery of concurrentDeliveries) {
          if (!draft.deliveries.some((item) => item.id === delivery.id)) {
            draft.deliveries.push(structuredClone(delivery));
          }
        }
        state = draft;
        transactions.push('commit');
        return result;
      } catch (error) {
        transactions.push('rollback');
        throw error;
      } finally {
        for (const id of transactionLocks) activeClaimLocks.delete(id);
      }
    },
  };
  const service = new SystemMessageFanoutService(
    dataSource as never,
    registry,
    new SystemMessageTemplateRendererService(),
  );
  return {
    adapter,
    bindings: () => state.bindings,
    events: () => state.events,
    deliveries: () => state.deliveries,
    deliveryReadLocks,
    failSubscription: (id: null | string) => {
      failSubscription = id;
    },
    failDeliveryTarget: (id: null | string) => {
      failDeliveryTarget = id;
    },
    lock: (id: string) => locked.add(id),
    newerEventReads,
    query,
    savedDeliveryTargets: () => savedDeliveryTargets,
    pauseNextClaim: () => {
      let entered!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let resume!: () => void;
      const wait = new Promise<void>((resolve) => {
        resume = resolve;
      });
      pauseClaim = { entered, resume: wait };
      return { reached, resume };
    },
    pauseNextEventLock: () => {
      let entered!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let resume!: () => void;
      const wait = new Promise<void>((resolve) => {
        resume = resolve;
      });
      pauseEventLock = { entered, resume: wait };
      return { reached, resume };
    },
    setDuplicateRace: (value: 'exact' | 'wrong' | null) => {
      duplicateRace = value;
    },
    service,
    targets: () => state.targets,
    templates: () => state.templates,
    transactions,
  };
}

describe('SystemMessageFanoutService', () => {
  it('creates exact multi-account target cardinality and freezes strict snapshots', async () => {
    const fixture = setup({
      accounts: [account(), account({ id: '401', selfId: 'bot-b' })],
      bindings: [
        binding(),
        binding({ accountId: '401', id: '501', selfId: 'bot-b' }),
      ],
      targets: [
        target(),
        target({ id: '701', targetId: 'private-1', targetType: 'private' }),
        target({ bindingId: '501', id: '702', targetId: 'group-2' }),
      ],
    });

    await expect(fixture.service.runOnce(NOW)).resolves.toBe(1);
    expect(fixture.deliveries()).toHaveLength(3);
    expect(
      new Set(fixture.deliveries().map((item) => item.publishTargetId)).size,
    ).toBe(3);
    expect(fixture.deliveries()[0]).toMatchObject({
      attemptCount: 0,
      bindingId: '500',
      renderedMessage: 'endpoint=pal.example.com:38213',
      selfId: 'bot-a',
      status: 'pending',
      subscriptionId: '300',
      templateContent: 'endpoint=${{endpoint}}',
      templateId: '600',
      variableSnapshot: { endpoint: 'pal.example.com:38213' },
    });
    expect(fixture.deliveries()[0].expiresAt.getTime()).toBe(
      NOW.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS,
    );
  });

  it('schedules ready and waiting-DDNS snapshots without sending OneBot', async () => {
    const fixture = setup();
    fixture.adapter.resolveDelivery.mockResolvedValueOnce({
      reasonCode: 'ddns_not_synced',
      status: 'waiting_ddns',
      variables: { endpoint: 'wait.example:1' },
    });

    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries()[0]).toMatchObject({
      renderedMessage: 'endpoint=wait.example:1',
      status: 'waiting_ddns',
    });
    expect(fixture.deliveries()[0].nextAttemptAt.getTime()).toBe(
      NOW.getTime() + SYSTEM_MESSAGE_DDNS_RECHECK_MS,
    );
    expect(fixture.events()[0].fanoutStatus).toBe('completed');
  });

  it('requires an active own string JSON resource match before resolving a subscription', async () => {
    const inherited = Object.create({ portForwardId: RESOURCE_KEY }) as Record<
      string,
      unknown
    >;
    const fixture = setup({
      subscriptions: [
        subscription(),
        subscription({
          id: '301',
          sourceConfig: { portForwardId: Number(RESOURCE_KEY) },
        }),
        subscription({ id: '302', sourceConfig: inherited }),
        subscription({ enabled: false, id: '303' }),
        subscription({ id: '304', isDeleted: true }),
      ],
    });

    await fixture.service.runOnce(NOW);
    expect(fixture.adapter.resolveDelivery).toHaveBeenCalledTimes(1);
  });

  it('isolates disabled/deleted or mismatched account, binding, template and target rows', async () => {
    const fixture = setup({
      accounts: [
        account(),
        account({ enabled: false, id: '401', selfId: 'bad' }),
      ],
      bindings: [
        binding(),
        binding({ accountId: '401', id: '501', selfId: 'bad' }),
        binding({ enabled: false, id: '502' }),
        binding({ id: '503', selfId: 'wrong' }),
      ],
      targets: [
        target(),
        target({ bindingId: '501', id: '701' }),
        target({ bindingId: '500', enabled: false, id: '702' }),
        target({ bindingId: '500', id: '703', isDeleted: true }),
      ],
    });

    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries().map((item) => item.publishTargetId)).toEqual([
      '700',
    ]);
  });

  it.each(['cancelled', 'superseded'] as const)(
    'completes %s readiness without current delivery or render',
    async (status) => {
      const fixture = setup();
      fixture.adapter.resolveDelivery.mockResolvedValueOnce({
        reasonCode: status,
        status,
      });

      await fixture.service.runOnce(NOW);
      expect(fixture.deliveries()).toHaveLength(0);
      expect(fixture.events()[0].fanoutStatus).toBe('completed');
    },
  );

  it('supersedes only strictly earlier unfinished deliveries for the same subscription', async () => {
    const older = event({
      id: '100',
      occurredAt: new KtDateTime(NOW.getTime() - 1),
    });
    const makeDelivery = (
      id: string,
      messageEventId: string,
      status: QqbotMessageDelivery['status'],
    ) =>
      Object.assign(new QqbotMessageDelivery(), {
        id,
        messageEventId,
        publishTargetId: id,
        status,
        subscriptionId: '300',
      });
    const fixture = setup({
      events: [older, event()],
      deliveries: [
        makeDelivery('1', '100', 'pending'),
        makeDelivery('2', '100', 'retry'),
        makeDelivery('3', '100', 'processing'),
        makeDelivery('4', '200', 'pending'),
        makeDelivery('5', '201', 'pending'),
      ],
    });

    await fixture.service.runOnce(NOW);
    expect(
      fixture
        .deliveries()
        .filter((item) => item.messageEventId === '100')
        .map((item) => item.status),
    ).toEqual(['superseded', 'superseded', 'processing']);
    expect(
      fixture.deliveries().find((item) => item.messageEventId === '201')
        ?.status,
    ).toBe('pending');
    expect(
      fixture.deliveries().find((item) => item.messageEventId === '200')
        ?.status,
    ).toBe('pending');
  });

  it('does not recreate old A work after committed A-to-B-to-A events return to A', async () => {
    const oldLease = new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS);
    const oldEvent = event({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: oldLease,
      fanoutStatus: 'processing',
      id: '9',
      occurredAt: new KtDateTime(NOW.getTime() - 2),
      payload: { endpoint: 'endpoint-a', portForwardId: RESOURCE_KEY },
    });
    const middleEvent = event({
      fanoutStatus: 'completed',
      id: '10',
      nextFanoutAt: null,
      occurredAt: new KtDateTime(NOW.getTime() - 1),
      payload: { endpoint: 'endpoint-b', portForwardId: RESOURCE_KEY },
    });
    const newestEvent = event({
      fanoutStatus: 'completed',
      id: '11',
      nextFanoutAt: null,
      payload: { endpoint: 'endpoint-a', portForwardId: RESOURCE_KEY },
    });
    const unrelatedSourceEvent = event({
      fanoutStatus: 'completed',
      id: '12',
      nextFanoutAt: null,
      resourceKey: 'other-resource',
      sourceKey: 'other.source',
    });
    const oldRows = [
      'waiting_ddns',
      'pending',
      'retry',
      'processing',
      'success',
    ].map((status, index) =>
      Object.assign(new QqbotMessageDelivery(), {
        id: `old-${index}`,
        messageEventId: oldEvent.id,
        publishTargetId: `old-target-${index}`,
        status,
        subscriptionId: '300',
      }),
    );
    const newestDelivery = Object.assign(new QqbotMessageDelivery(), {
      id: 'newest',
      messageEventId: newestEvent.id,
      publishTargetId: '700',
      renderedMessage: 'endpoint=endpoint-a',
      status: 'pending',
      subscriptionId: '300',
    });
    const unrelated = Object.assign(new QqbotMessageDelivery(), {
      id: 'unrelated',
      messageEventId: unrelatedSourceEvent.id,
      publishTargetId: 'other-target',
      status: 'pending',
      subscriptionId: '301',
    });
    const unrelatedSourceResource = Object.assign(new QqbotMessageDelivery(), {
      id: 'unrelated-source-resource',
      messageEventId: unrelatedSourceEvent.id,
      publishTargetId: 'other-source-resource-target',
      status: 'pending',
      subscriptionId: '300',
    });
    const fixture = setup({
      deliveries: [
        ...oldRows,
        newestDelivery,
        unrelated,
        unrelatedSourceResource,
      ],
      events: [oldEvent, middleEvent, newestEvent, unrelatedSourceEvent],
    });
    const processClaim = (
      fixture.service as unknown as {
        processClaim: (token: object, now: Date) => Promise<void>;
      }
    ).processClaim;
    const newestSnapshot = structuredClone(newestDelivery);

    await processClaim.call(
      fixture.service,
      { attempt: 1, event: oldEvent, leaseUntil: oldLease },
      NOW,
    );

    expect(fixture.newerEventReads).toHaveLength(1);
    expect(fixture.adapter.resolveDelivery).not.toHaveBeenCalled();
    expect(
      fixture
        .deliveries()
        .filter((item) => item.messageEventId === oldEvent.id),
    ).toHaveLength(5);
    expect(
      fixture
        .deliveries()
        .filter((item) => item.messageEventId === oldEvent.id)
        .map((item) => item.status),
    ).toEqual([
      'superseded',
      'superseded',
      'superseded',
      'processing',
      'success',
    ]);
    expect(
      fixture.deliveries().find((item) => item.id === newestDelivery.id),
    ).toEqual(newestSnapshot);
    expect(
      fixture.deliveries().find((item) => item.id === unrelated.id),
    ).toEqual(unrelated);
    expect(
      fixture
        .deliveries()
        .find((item) => item.id === unrelatedSourceResource.id),
    ).toEqual(unrelatedSourceResource);
    expect(
      fixture.events().find((item) => item.id === oldEvent.id),
    ).toMatchObject({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: null,
      fanoutStatus: 'completed',
    });
    expect(fixture.newerEventReads).toEqual([
      {
        lock: 'pessimistic_read',
        order: [],
        predicates: [
          {
            expression:
              'newerEvent.sourceKey = :sourceKey AND newerEvent.resourceKey = :resourceKey',
            parameters: { sourceKey: SOURCE_KEY, resourceKey: RESOURCE_KEY },
          },
          {
            brackets: [
              {
                expression: 'newerEvent.occurredAt > :occurredAt',
                parameters: { occurredAt: oldEvent.occurredAt },
              },
              {
                expression:
                  'newerEvent.occurredAt = :occurredAt AND newerEvent.id > :eventId',
                parameters: {
                  occurredAt: oldEvent.occurredAt,
                  eventId: oldEvent.id,
                },
              },
            ],
          },
        ],
        take: 1,
      },
    ]);
  });

  it('treats same-timestamp BIGINT id 10 as newer than lexical-trap id 9', async () => {
    const oldLease = new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS);
    const oldEvent = event({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: oldLease,
      fanoutStatus: 'processing',
      id: '9',
      payload: { endpoint: 'endpoint-a', portForwardId: RESOURCE_KEY },
    });
    const newestEvent = event({
      fanoutStatus: 'completed',
      id: '10',
      nextFanoutAt: null,
      payload: { endpoint: 'endpoint-a', portForwardId: RESOURCE_KEY },
    });
    const oldDelivery = Object.assign(new QqbotMessageDelivery(), {
      id: 'old',
      messageEventId: oldEvent.id,
      publishTargetId: 'old-target',
      status: 'pending',
      subscriptionId: '300',
    });
    const fixture = setup({
      deliveries: [oldDelivery],
      events: [oldEvent, newestEvent],
    });
    const processClaim = (
      fixture.service as unknown as {
        processClaim: (token: object, now: Date) => Promise<void>;
      }
    ).processClaim;

    await processClaim.call(
      fixture.service,
      { attempt: 1, event: oldEvent, leaseUntil: oldLease },
      NOW,
    );

    expect(fixture.adapter.resolveDelivery).not.toHaveBeenCalled();
    expect(fixture.deliveries()).toEqual([
      expect.objectContaining({ id: 'old', status: 'superseded' }),
    ]);
  });

  it('accepts exact event-target replay and verifies only an exact duplicate-key race', async () => {
    const existing = Object.assign(new QqbotMessageDelivery(), {
      id: 'old',
      messageEventId: '200',
      publishTargetId: '700',
      status: 'pending',
    });
    const replay = setup({ deliveries: [existing] });
    await replay.service.runOnce(NOW);
    expect(replay.deliveries()).toHaveLength(1);

    const race = setup();
    race.setDuplicateRace('exact');
    await race.service.runOnce(NOW);
    expect(race.deliveries()).toHaveLength(1);
    expect(race.deliveryReadLocks).toEqual([null, 'pessimistic_read']);

    const wrong = setup();
    wrong.setDuplicateRace('wrong');
    await wrong.service.runOnce(NOW);
    expect(wrong.events()[0]).toMatchObject({
      fanoutStatus: 'retry',
      lastErrorCode: 'fanout_transient_error',
    });
  });

  it('records bounded SQL claim contract including top-level Brackets, locking, ordering and limit', async () => {
    const fixture = setup({ events: [] });
    await fixture.service.runOnce(NOW);
    expect(fixture.query).toMatchObject({
      brackets: true,
      lock: 'pessimistic_write',
      onLocked: 'skip_locked',
      take: 1,
    });
    expect(fixture.query.order).toEqual(['event.occurredAt', 'event.id']);
    expect(fixture.query.predicates).toEqual([
      {
        brackets: [
          {
            brackets: [
              {
                expression:
                  'event.fanoutStatus IN (:...due) AND (event.nextFanoutAt IS NULL OR event.nextFanoutAt <= :now)',
                parameters: { due: ['accepted', 'retry'], now: NOW },
              },
            ],
          },
          {
            expression:
              'event.fanoutStatus = :processing AND event.fanoutLeaseUntil <= :now',
            parameters: { processing: 'processing', now: NOW },
          },
        ],
      },
    ]);
  });

  it.each(['accepted', 'retry'] as const)(
    'claims %s events with a null schedule as immediately due',
    async (fanoutStatus) => {
      const fixture = setup({
        events: [event({ fanoutStatus, nextFanoutAt: null })],
      });

      await expect(fixture.service.runOnce(NOW)).resolves.toBe(1);
      expect(fixture.events()[0].fanoutStatus).toBe('completed');
      expect(fixture.deliveries()).toHaveLength(1);
    },
  );

  it('gives overlapping claim transactions one owner only through write lock and skip-locked selection', async () => {
    const fixture = setup();
    const gate = fixture.pauseNextClaim();
    const first = fixture.service.runOnce(NOW);
    await gate.reached;
    await expect(fixture.service.runOnce(NOW)).resolves.toBe(0);
    gate.resume();
    await expect(first).resolves.toBe(1);
    expect(fixture.events()[0].fanoutAttemptCount).toBe(1);
  });

  it('lets the current event-lock holder finish atomically while an expired-lease reclaim waits', async () => {
    const fixture = setup();
    const gate = fixture.pauseNextEventLock();
    const currentOwner = fixture.service.runOnce(NOW);
    await gate.reached;
    expect(fixture.events()[0].fanoutLeaseUntil?.getTime()).toBe(
      NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS,
    );

    await expect(
      fixture.service.runOnce(
        new Date(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS),
      ),
    ).resolves.toBe(0);

    gate.resume();
    await expect(currentOwner).resolves.toBe(1);
    expect(fixture.events()[0].fanoutStatus).toBe('completed');
    expect(fixture.deliveries()).toHaveLength(1);
  });

  it('skips a locked oldest due event and reclaims expired processing with an exact new lease', async () => {
    const oldest = event({
      id: '100',
      occurredAt: new KtDateTime(NOW.getTime() - 2),
    });
    const expired = event({
      fanoutAttemptCount: 4,
      fanoutLeaseUntil: new KtDateTime(NOW.getTime() - 1),
      fanoutStatus: 'processing',
      id: '101',
      nextFanoutAt: null,
      occurredAt: new KtDateTime(NOW.getTime() - 1),
    });
    const fixture = setup({ events: [oldest, expired] });
    fixture.lock('100');

    await fixture.service.runOnce(NOW);
    expect(fixture.events().find((item) => item.id === '101')).toMatchObject({
      fanoutAttemptCount: 5,
      fanoutStatus: 'completed',
    });
    expect(fixture.events().find((item) => item.id === '100')).toMatchObject({
      fanoutStatus: 'accepted',
    });
  });

  it('uses independent attempt and lease ownership fences so stale completion cannot clobber a new owner', async () => {
    const fixture = setup({ events: [] });
    const staleEvent = event({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS),
      fanoutStatus: 'processing',
    });
    const attemptMismatch = event({
      fanoutAttemptCount: 2,
      fanoutLeaseUntil: staleEvent.fanoutLeaseUntil,
      fanoutStatus: 'processing',
    });
    const leaseMismatch = event({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: new KtDateTime(
        NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS + 1,
      ),
      fanoutStatus: 'processing',
    });
    const finish = (
      fixture.service as unknown as {
        finish: (
          token: object,
          status: 'completed',
          code: null,
          message: null,
        ) => Promise<void>;
      }
    ).finish;
    (fixture as unknown as { events: () => QqbotMessageEvent[] })
      .events()
      .push(attemptMismatch);

    await finish.call(
      fixture.service,
      {
        attempt: 1,
        event: staleEvent,
        leaseUntil: staleEvent.fanoutLeaseUntil,
      },
      'completed',
      null,
      null,
    );
    expect(fixture.events()[0].fanoutStatus).toBe('processing');

    fixture.events().splice(0, 1, leaseMismatch);
    await finish.call(
      fixture.service,
      {
        attempt: 1,
        event: staleEvent,
        leaseUntil: staleEvent.fanoutLeaseUntil,
      },
      'completed',
      null,
      null,
    );
    expect(fixture.events()[0].fanoutStatus).toBe('processing');
  });

  it('stops a stale owner before supersession or inserts after a newer owner completes', async () => {
    const staleEvent = event({
      fanoutAttemptCount: 1,
      fanoutLeaseUntil: new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS),
      fanoutStatus: 'processing',
    });
    const winningEvent = event({
      fanoutAttemptCount: 2,
      fanoutLeaseUntil: null,
      fanoutStatus: 'completed',
    });
    const prior = Object.assign(new QqbotMessageDelivery(), {
      id: 'prior',
      messageEventId: '100',
      publishTargetId: 'old-target',
      status: 'pending',
      subscriptionId: '300',
    });
    const fixture = setup({
      deliveries: [prior],
      events: [
        winningEvent,
        event({
          id: '100',
          occurredAt: new KtDateTime(NOW.getTime() - 1),
          nextFanoutAt: new KtDateTime(NOW.getTime() + 1),
        }),
      ],
    });
    const processClaim = (
      fixture.service as unknown as {
        processClaim: (token: object, now: Date) => Promise<void>;
      }
    ).processClaim;

    await processClaim.call(
      fixture.service,
      {
        attempt: 1,
        event: staleEvent,
        leaseUntil: staleEvent.fanoutLeaseUntil,
      },
      NOW,
    );

    expect(fixture.deliveries()).toEqual([prior]);
    expect(fixture.events()[0]).toMatchObject({
      fanoutAttemptCount: 2,
      fanoutStatus: 'completed',
    });
    expect(fixture.adapter.resolveDelivery).not.toHaveBeenCalled();
  });

  it('rolls back one failing subscription, retains valid work, then retries and recovers idempotently', async () => {
    const fixture = setup({
      subscriptions: [subscription(), subscription({ id: '301' })],
      bindings: [binding(), binding({ id: '501', subscriptionId: '301' })],
      targets: [target(), target({ bindingId: '501', id: '701' })],
    });
    fixture.failSubscription('501');
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries().map((item) => item.publishTargetId)).toEqual([
      '700',
    ]);
    expect(fixture.events()[0]).toMatchObject({
      fanoutStatus: 'retry',
      nextFanoutAt: new KtDateTime(
        NOW.getTime() + SYSTEM_MESSAGE_RETRY_BASE_MS,
      ),
    });
    fixture.failSubscription(null);
    fixture.events()[0].nextFanoutAt = new KtDateTime(NOW);
    await fixture.service.runOnce(NOW);
    expect(
      new Set(fixture.deliveries().map((item) => item.publishTargetId)),
    ).toEqual(new Set(['700', '701']));
    expect(fixture.events()[0].fanoutStatus).toBe('completed');
    expect(fixture.transactions).toContain('rollback');
  });

  it('rolls back supersession and an earlier target insert when a subscription later fails', async () => {
    const older = event({
      id: '100',
      occurredAt: new KtDateTime(NOW.getTime() - 1),
      nextFanoutAt: new KtDateTime(NOW.getTime() + 1),
    });
    const priorFailed = Object.assign(new QqbotMessageDelivery(), {
      id: 'old-failed',
      messageEventId: '100',
      publishTargetId: 'old-failed-target',
      status: 'pending',
      subscriptionId: '301',
    });
    const fixture = setup({
      deliveries: [priorFailed],
      events: [older, event()],
      subscriptions: [subscription(), subscription({ id: '301' })],
      bindings: [binding(), binding({ id: '501', subscriptionId: '301' })],
      targets: [
        target(),
        target({ bindingId: '501', id: '701' }),
        target({ bindingId: '501', id: '702', targetId: 'group-3' }),
      ],
    });
    fixture.failDeliveryTarget('702');

    await fixture.service.runOnce(NOW);

    expect(
      fixture.deliveries().find((item) => item.id === 'old-failed'),
    ).toMatchObject({ status: 'pending' });
    expect(fixture.deliveries().map((item) => item.publishTargetId)).toEqual([
      'old-failed-target',
      '700',
    ]);
    expect(fixture.savedDeliveryTargets()).toEqual([
      '700',
      'old-failed-target',
      '701',
    ]);
    expect(fixture.events()[1].fanoutStatus).toBe('retry');
  });

  it('fails at the occurrence deadline and permanently rejects malformed source facts', async () => {
    const deadline = setup({
      events: [
        event({
          occurredAt: new KtDateTime(
            NOW.getTime() - SYSTEM_MESSAGE_RETRY_WINDOW_MS,
          ),
        }),
      ],
    });
    await deadline.service.runOnce(NOW);
    expect(deadline.events()[0]).toMatchObject({
      fanoutStatus: 'failed',
      lastErrorCode: 'fanout_expired',
    });
    expect(deadline.deliveries()).toHaveLength(0);

    const malformed = setup({
      events: [event({ payload: { portForwardId: 'other' } })],
    });
    await malformed.service.runOnce(NOW);
    expect(malformed.events()[0]).toMatchObject({
      fanoutStatus: 'failed',
      lastErrorCode: 'event_resource_mismatch',
    });
  });

  it('bounds a pass to fifty oldest claims and leaves not-due rows untouched', async () => {
    const events = Array.from(
      { length: SYSTEM_MESSAGE_BATCH_SIZE + 1 },
      (_, index) =>
        event({
          id: `${1000 + index}`,
          occurredAt: new KtDateTime(
            NOW.getTime() - SYSTEM_MESSAGE_BATCH_SIZE + index,
          ),
        }),
    );
    const fixture = setup({ events });
    await expect(fixture.service.runOnce(NOW)).resolves.toBe(
      SYSTEM_MESSAGE_BATCH_SIZE,
    );
    expect(
      fixture.events().filter((item) => item.fanoutStatus === 'completed'),
    ).toHaveLength(SYSTEM_MESSAGE_BATCH_SIZE);
    expect(fixture.events().at(-1)?.fanoutStatus).toBe('accepted');
  });

  it('marks source contract errors as permanent failures rather than transient adapter retries', async () => {
    const fixture = setup();
    fixture.adapter.validateEventPayload.mockImplementation(() => {
      throw new SystemMessageContractError('payload_invalid');
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.events()[0]).toMatchObject({
      fanoutStatus: 'failed',
      lastErrorCode: 'payload_invalid',
    });
  });

  it('completes a matched event with no legal targets without resolving a default account', async () => {
    const fixture = setup({ targets: [] });
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries()).toHaveLength(0);
    expect(fixture.events()[0].fanoutStatus).toBe('completed');
  });

  it('does not resolve when no subscription matches the frozen source/resource', async () => {
    const fixture = setup({
      subscriptions: [
        subscription({ sourceConfig: { portForwardId: 'other' } }),
      ],
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.adapter.resolveDelivery).not.toHaveBeenCalled();
    expect(fixture.events()[0].fanoutStatus).toBe('completed');
  });

  it('leaves future retries and live processing leases unclaimed', async () => {
    const fixture = setup({
      events: [
        event({
          fanoutStatus: 'retry',
          nextFanoutAt: new KtDateTime(NOW.getTime() + 1),
        }),
        event({
          fanoutLeaseUntil: new KtDateTime(NOW.getTime() + 1),
          fanoutStatus: 'processing',
          id: '201',
          nextFanoutAt: null,
        }),
      ],
    });
    await expect(fixture.service.runOnce(NOW)).resolves.toBe(0);
    expect(fixture.events().map((item) => item.fanoutStatus)).toEqual([
      'retry',
      'processing',
    ]);
  });

  it('keeps a runtime-offline but enabled strict account eligible at fan-out', async () => {
    const fixture = setup({
      accounts: [
        account({ connectStatus: 'offline', oneBotStatus: 'offline' }),
      ],
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries()).toHaveLength(1);
  });

  it('isolates an invalid template render while allowing another legal binding', async () => {
    const fixture = setup({
      bindings: [binding(), binding({ id: '501', templateId: '601' })],
      templates: [
        template({ content: '${{unknown}}' }),
        template({ id: '601' }),
      ],
      targets: [target(), target({ bindingId: '501', id: '701' })],
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries().map((item) => item.publishTargetId)).toEqual([
      '701',
    ]);
  });

  it('does not supersede current-event rows during an idempotent replay', async () => {
    const fixture = setup({
      deliveries: [
        Object.assign(new QqbotMessageDelivery(), {
          id: 'old',
          messageEventId: '200',
          publishTargetId: '700',
          status: 'retry',
          subscriptionId: '300',
        }),
      ],
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries()[0].status).toBe('retry');
  });

  it('uses numeric BIGINT ordering when occurrence times are equal', async () => {
    const older = event({ id: '9', occurredAt: new KtDateTime(NOW) });
    const current = event({ id: '10', occurredAt: new KtDateTime(NOW) });
    const fixture = setup({
      events: [current, older],
      deliveries: [
        Object.assign(new QqbotMessageDelivery(), {
          id: 'old',
          messageEventId: '9',
          publishTargetId: 'old-target',
          status: 'pending',
          subscriptionId: '300',
        }),
      ],
    });
    await fixture.service.runOnce(NOW);
    expect(fixture.deliveries()[0].status).toBe('superseded');
  });

  it('marks a transient event failure retryable with the one-based ten-second delay', async () => {
    const fixture = setup();
    fixture.adapter.resolveDelivery.mockRejectedValueOnce(
      new Error('adapter unavailable'),
    );
    await fixture.service.runOnce(NOW);
    expect(fixture.events()[0]).toMatchObject({
      fanoutStatus: 'retry',
      lastErrorCode: 'fanout_transient_error',
    });
    expect(fixture.events()[0].nextFanoutAt.getTime()).toBe(
      NOW.getTime() + SYSTEM_MESSAGE_RETRY_BASE_MS,
    );
  });

  it('fails immediately when the next transient retry would fall outside the hard deadline', async () => {
    const fixture = setup({
      events: [
        event({
          occurredAt: new KtDateTime(
            NOW.getTime() - SYSTEM_MESSAGE_RETRY_WINDOW_MS + 1,
          ),
        }),
      ],
    });
    fixture.adapter.resolveDelivery.mockRejectedValueOnce(
      new Error('adapter unavailable'),
    );
    await fixture.service.runOnce(NOW);
    expect(fixture.events()[0]).toMatchObject({
      fanoutStatus: 'failed',
      lastErrorCode: 'fanout_expired',
      nextFanoutAt: null,
    });
  });

  it('fails an unknown source permanently without mutating subscriptions or deliveries', async () => {
    const fixture = setup({ events: [event({ sourceKey: 'unknown.source' })] });
    await fixture.service.runOnce(NOW);
    expect(fixture.events()[0]).toMatchObject({
      fanoutStatus: 'failed',
      lastErrorCode: 'unknown_message_source',
    });
    expect(fixture.deliveries()).toHaveLength(0);
  });

  it('calls the adapter exactly once per matched subscription rather than once per target', async () => {
    const fixture = setup({ targets: [target(), target({ id: '701' })] });
    await fixture.service.runOnce(NOW);
    expect(fixture.adapter.resolveDelivery).toHaveBeenCalledTimes(1);
  });

  it('keeps processing and terminal historical deliveries outside supersession', async () => {
    const older = event({
      id: '100',
      occurredAt: new KtDateTime(NOW.getTime() - 1),
    });
    const statuses: QqbotMessageDelivery['status'][] = [
      'processing',
      'success',
      'failed',
      'superseded',
      'cancelled',
    ];
    const fixture = setup({
      events: [older, event()],
      deliveries: statuses.map((status, index) =>
        Object.assign(new QqbotMessageDelivery(), {
          id: `${index}`,
          messageEventId: '100',
          publishTargetId: `${index}`,
          status,
          subscriptionId: '300',
        }),
      ),
    });
    await fixture.service.runOnce(NOW);
    expect(
      fixture
        .deliveries()
        .filter((item) => ['0', '1', '2', '3', '4'].includes(item.id))
        .map((item) => item.status),
    ).toEqual(statuses);
  });

  it('preserves every delivery snapshot after source configuration rows later change', async () => {
    const fixture = setup();
    await fixture.service.runOnce(NOW);
    const expectedFrozenDelivery = structuredClone(fixture.deliveries()[0]);
    fixture.templates()[0].content = 'changed=${{endpoint}}';
    fixture.bindings()[0].selfId = 'changed-bot';
    fixture.targets()[0].targetId = 'changed-target';
    const persistedDelivery = fixture.deliveries()[0];

    expect(persistedDelivery).toEqual(expectedFrozenDelivery);
    expect(persistedDelivery).toMatchObject({
      attemptCount: 0,
      bindingId: '500',
      lastErrorCode: null,
      lastErrorMessage: null,
      messageEventId: '200',
      processingLeaseUntil: null,
      publishTargetId: '700',
      renderedMessage: 'endpoint=pal.example.com:38213',
      sendLogId: null,
      selfId: 'bot-a',
      status: 'pending',
      subscriptionId: '300',
      templateContent: 'endpoint=${{endpoint}}',
      templateId: '600',
      targetId: 'group-1',
      targetType: 'group',
      variableSnapshot: { endpoint: 'pal.example.com:38213' },
    });
    expect(persistedDelivery.nextAttemptAt.getTime()).toBe(NOW.getTime());
    expect(persistedDelivery.expiresAt.getTime()).toBe(
      NOW.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS,
    );
  });
});
