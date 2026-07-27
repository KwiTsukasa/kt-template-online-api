import { KtDateTime } from '../../../../src/common';
import {
  deliveryRetryDelayMs,
  SystemMessageDeliveryRunnerService,
} from '../../../../src/modules/qqbot/core/application/message-push/system-message-delivery-runner.service';
import { SystemMessageDeliveryCoordinatorService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-delivery-coordinator.service';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_DDNS_RECHECK_MS,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
} from '../../../../src/modules/qqbot/core/application/message-push/system-message-runner.constants';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-template-renderer.service';
import { QqbotSendAttemptError } from '../../../../src/modules/qqbot/core/application/send/qqbot-send.error';
import {
  SystemMessageContractError,
  type StrictPlainTextSendInput,
  type SystemMessageSourceAdapter,
} from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { QqbotAccount } from '../../../../src/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';

const NOW = new Date('2026-07-24T00:00:00.000Z');
const SOURCE_KEY = 'network.stun.mapping-port-changed';
const TCP_SOURCE_KEY = 'network.tcp.natmap-endpoint-changed';
const RESOURCE_KEY = '9007199254740993';

type Store = {
  accounts: QqbotAccount[];
  bindings: QqbotMessagePublishBinding[];
  deliveries: QqbotMessageDelivery[];
  events: QqbotMessageEvent[];
  subscriptions: QqbotMessageSubscription[];
  targets: QqbotMessagePublishTarget[];
};

type QueryRecord = {
  lock: string;
  onLocked: string;
  orders: string[];
  predicates: Array<{
    expression: string;
    parameters: Record<string, unknown>;
  }>;
  take: number;
  topLevelBrackets: boolean;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function event(overrides: Partial<QqbotMessageEvent> = {}) {
  return Object.assign(new QqbotMessageEvent(), {
    id: '201',
    occurredAt: new KtDateTime(NOW),
    payload: {
      currentPort: 38213,
      portForwardId: RESOURCE_KEY,
      previousPort: 8213,
      publicIpv4: '203.0.113.10',
    },
    resourceKey: RESOURCE_KEY,
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

function subscription(overrides: Partial<QqbotMessageSubscription> = {}) {
  return Object.assign(new QqbotMessageSubscription(), {
    enabled: true,
    id: '301',
    isDeleted: false,
    sourceConfig: {
      ddnsRecordId: '9007199254740995',
      portForwardId: RESOURCE_KEY,
    },
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

function account(overrides: Partial<QqbotAccount> = {}) {
  return Object.assign(new QqbotAccount(), {
    enabled: true,
    id: '401',
    isDeleted: false,
    selfId: 'bot-a',
    ...overrides,
  });
}

function binding(overrides: Partial<QqbotMessagePublishBinding> = {}) {
  return Object.assign(new QqbotMessagePublishBinding(), {
    accountId: '401',
    enabled: true,
    id: '501',
    isDeleted: false,
    selfId: 'bot-a',
    subscriptionId: '301',
    templateId: '601',
    ...overrides,
  });
}

function target(overrides: Partial<QqbotMessagePublishTarget> = {}) {
  return Object.assign(new QqbotMessagePublishTarget(), {
    bindingId: '501',
    enabled: true,
    id: '701',
    isDeleted: false,
    targetId: 'group-1',
    targetType: 'group',
    ...overrides,
  });
}

function delivery(overrides: Partial<QqbotMessageDelivery> = {}) {
  return Object.assign(new QqbotMessageDelivery(), {
    attemptCount: 0,
    bindingId: '501',
    expiresAt: new KtDateTime(NOW.getTime() + 24 * 60 * 60_000),
    id: '801',
    lastErrorCode: 'old_error',
    lastErrorMessage: 'old message',
    messageEventId: '201',
    nextAttemptAt: new KtDateTime(NOW),
    processingLeaseUntil: null,
    publishTargetId: '701',
    renderedMessage: 'endpoint=pal.example.com:38213 port=38213',
    selfId: 'bot-a',
    sendLogId: 'old-log',
    status: 'pending',
    subscriptionId: '301',
    targetId: 'group-1',
    targetType: 'group',
    templateContent: 'endpoint=${{endpoint}} port=${{port}}',
    templateId: '601',
    variableSnapshot: {
      endpoint: 'pal.example.com:38213',
      port: 38213,
    },
    ...overrides,
  });
}

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
  };
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && expected instanceof Date)
    return actual.getTime() === expected.getTime();
  return actual === expected;
}

function conditionValues(value: unknown): unknown[] | null {
  if (
    value &&
    typeof value === 'object' &&
    '_type' in value &&
    (value as { _type?: unknown })._type === 'in'
  )
    return (value as unknown as { _value: unknown[] })._value;
  return null;
}

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown> = {},
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const values = conditionValues(expected);
    return values
      ? values.some((value) => sameValue(row[key], value))
      : sameValue(row[key], expected);
  });
}

function setup(seed: Partial<Store> = {}, sourceKey = SOURCE_KEY) {
  let state: Store = {
    accounts: seed.accounts ?? [account()],
    bindings: seed.bindings ?? [binding()],
    deliveries: seed.deliveries ?? [delivery()],
    events: seed.events ?? [event()],
    subscriptions: seed.subscriptions ?? [subscription()],
    targets: seed.targets ?? [target()],
  };
  const registry = new SystemMessageSourceRegistry();
  const adapter: jest.Mocked<SystemMessageSourceAdapter> = {
    definition: {
      description: 'test',
      displayName: 'test',
      sourceKey,
      subscriptionFields: [],
      variables: [
        {
          description: 'endpoint',
          example: 'pal.example.com:38213',
          key: 'endpoint',
          label: 'endpoint',
          type: 'string',
        },
        {
          description: 'port',
          example: '38213',
          key: 'port',
          label: 'port',
          type: 'number',
        },
      ],
      version: 1,
    },
    eventResourceKey: jest.fn(),
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(
      async (
        _input: Parameters<SystemMessageSourceAdapter['resolveDelivery']>[0],
      ) => {
        void _input;
        return {
          reasonCode: null,
          status: 'ready' as const,
          variables: { endpoint: 'current.example.com:39999', port: 39999 },
        };
      },
    ),
    subscriptionResourceKey: jest.fn(),
    validateEventPayload: jest.fn(
      (payload) => payload as Record<string, boolean | null | number | string>,
    ),
  };
  registry.register(adapter);
  const operations: string[] = [];
  const lockOrder: string[] = [];
  const queries: QueryRecord[] = [];
  const senderDepths: number[] = [];
  const preparationClaimLocks: boolean[] = [];
  const externalUpdates: Array<{
    values: Record<string, unknown>;
    where: Record<string, unknown>;
  }> = [];
  const activeLocks = new Set<string>();
  let transactionDepth = 0;
  let externalUpdateFailures = 0;
  let beforeExternalUpdate:
    | null
    | ((authoritative: Store, where: Record<string, unknown>) => void) = null;
  let beforePreparationDeliveryRead: null | ((draft: Store) => void) = null;
  let afterClaimCommit: null | ((authoritative: Store) => void) = null;
  let pauseNextClaim: null | { entered: () => void; resume: Promise<void> } =
    null;

  const sender = {
    sendStrictPlainText: jest.fn(
      async (_input: StrictPlainTextSendInput): Promise<{ logId: string }> => {
        void _input;
        senderDepths.push(transactionDepth);
        operations.push('send');
        return { logId: 'send-log-1' };
      },
    ),
  };

  const mergeRows = <T extends { id: string }>(
    authoritative: T[],
    draft: T[],
    baseline: T[],
  ): T[] => {
    const merged = new Map(authoritative.map((row) => [row.id, row]));
    const baselineById = new Map(baseline.map((row) => [row.id, row]));
    for (const row of draft) {
      if (
        !baselineById.has(row.id) ||
        JSON.stringify(row) !== JSON.stringify(baselineById.get(row.id))
      )
        merged.set(row.id, row);
    }
    return [...merged.values()];
  };

  const mergeCommitted = (draft: Store, baseline: Store): void => {
    state = {
      accounts: mergeRows(state.accounts, draft.accounts, baseline.accounts),
      bindings: mergeRows(state.bindings, draft.bindings, baseline.bindings),
      deliveries: mergeRows(
        state.deliveries,
        draft.deliveries,
        baseline.deliveries,
      ),
      events: mergeRows(state.events, draft.events, baseline.events),
      subscriptions: mergeRows(
        state.subscriptions,
        draft.subscriptions,
        baseline.subscriptions,
      ),
      targets: mergeRows(state.targets, draft.targets, baseline.targets),
    };
  };

  const rowsFor = (entity: unknown, store: Store) => {
    if (entity === QqbotAccount) return store.accounts;
    if (entity === QqbotMessageEvent) return store.events;
    if (entity === QqbotMessageSubscription) return store.subscriptions;
    if (entity === QqbotMessagePublishBinding) return store.bindings;
    if (entity === QqbotMessagePublishTarget) return store.targets;
    return store.deliveries;
  };

  const repository = (
    entity: unknown,
    store: Store,
    context?: { claim: boolean; preparation: boolean },
    transactionLocks?: Set<string>,
  ) => {
    const rows = rowsFor(entity, store) as unknown as Array<
      Record<string, unknown>
    >;
    return {
      createQueryBuilder: (_alias: string) => {
        void _alias;
        const record: QueryRecord = {
          lock: '',
          onLocked: '',
          orders: [],
          predicates: [],
          take: 0,
          topLevelBrackets: false,
        };
        queries.push(record);
        let queryNow = NOW;
        const builder = {
          addOrderBy: (expression: string, order: string) => {
            record.orders.push(`${expression} ${order}`);
            return builder;
          },
          getOne: async () => {
            const due = (rows as unknown as QqbotMessageDelivery[])
              .filter((item) => {
                const scheduled =
                  ['pending', 'retry', 'waiting_ddns'].includes(item.status) &&
                  !!item.nextAttemptAt &&
                  item.nextAttemptAt.getTime() <= queryNow.getTime();
                const expiredLease =
                  item.status === 'processing' &&
                  !!item.processingLeaseUntil &&
                  item.processingLeaseUntil.getTime() <= queryNow.getTime();
                return scheduled || expiredLease;
              })
              .sort((left, right) => {
                const leftTime = left.nextAttemptAt?.getTime() ?? -Infinity;
                const rightTime = right.nextAttemptAt?.getTime() ?? -Infinity;
                if (leftTime !== rightTime) return leftTime - rightTime;
                return BigInt(left.id) < BigInt(right.id) ? -1 : 1;
              })
              .find((item) => !activeLocks.has(`delivery:${item.id}`));
            if (!due) return null;
            const lockKey = `delivery:${due.id}`;
            activeLocks.add(lockKey);
            transactionLocks?.add(lockKey);
            if (context) context.claim = true;
            const pause = pauseNextClaim;
            pauseNextClaim = null;
            if (pause) {
              pause.entered();
              await pause.resume;
            }
            return due;
          },
          orderBy: (expression: string, order: string) => {
            record.orders.push(`${expression} ${order}`);
            return builder;
          },
          setLock: (mode: string) => {
            record.lock = mode;
            return builder;
          },
          setOnLocked: (mode: string) => {
            record.onLocked = mode;
            return builder;
          },
          take: (count: number) => {
            record.take = count;
            return builder;
          },
          where: (condition: unknown) => {
            record.topLevelBrackets =
              !!condition &&
              typeof condition === 'object' &&
              'whereFactory' in condition;
            if (record.topLevelBrackets) {
              const recorder = {
                orWhere: (
                  expression: string,
                  parameters: Record<string, unknown> = {},
                ) => {
                  record.predicates.push({ expression, parameters });
                  if (parameters.now instanceof Date) queryNow = parameters.now;
                  return recorder;
                },
                where: (
                  expression: string,
                  parameters: Record<string, unknown> = {},
                ) => {
                  record.predicates.push({ expression, parameters });
                  if (parameters.now instanceof Date) queryNow = parameters.now;
                  return recorder;
                },
              };
              (
                condition as {
                  whereFactory: (builderValue: typeof recorder) => void;
                }
              ).whereFactory(recorder);
            }
            return builder;
          },
        };
        return builder;
      },
      find: async (
        options: {
          where?: Record<string, unknown>;
        } = {},
      ) => rows.filter((row) => matches(row, options.where)),
      findOne: async (options: {
        lock?: { mode: string };
        where: Record<string, unknown>;
      }) => {
        if (options.lock) {
          lockOrder.push((entity as { name?: string }).name || 'unknown');
          if (entity === QqbotMessageDelivery) {
            if (context) context.preparation = true;
            beforePreparationDeliveryRead?.(store);
            preparationClaimLocks.push(
              activeLocks.has(`delivery:${String(options.where.id)}`),
            );
          }
        }
        return rows.find((row) => matches(row, options.where)) ?? null;
      },
      save: async (item: Record<string, unknown>) => item,
      update: async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        if (!context) {
          externalUpdates.push({ values, where });
          beforeExternalUpdate?.(state, where);
          if (externalUpdateFailures > 0) {
            externalUpdateFailures -= 1;
            throw new Error('simulated persistence failure');
          }
        }
        let affected = 0;
        for (const row of rowsFor(
          entity,
          context ? store : state,
        ) as unknown as Array<Record<string, unknown>>) {
          if (!matches(row, where)) continue;
          Object.assign(row, values);
          affected += 1;
        }
        return { affected };
      },
    };
  };

  const dataSource = {
    getRepository: (entity: unknown) => repository(entity, state),
    transaction: async <T>(
      callback: (manager: {
        getRepository: (entity: unknown) => ReturnType<typeof repository>;
      }) => Promise<T>,
    ) => {
      const baseline = cloneStore(state);
      const draft = cloneStore(state);
      const transactionLocks = new Set<string>();
      const context = { claim: false, preparation: false };
      transactionDepth += 1;
      try {
        const result = await callback({
          getRepository: (entity: unknown) =>
            repository(entity, draft, context, transactionLocks),
        });
        mergeCommitted(draft, baseline);
        if (context.claim && afterClaimCommit) {
          const callback = afterClaimCommit;
          afterClaimCommit = null;
          callback(state);
        }
        operations.push(
          context.claim
            ? 'claim:commit'
            : context.preparation
              ? 'prepare:commit'
              : 'transaction:commit',
        );
        return result;
      } catch (error) {
        operations.push('transaction:rollback');
        throw error;
      } finally {
        for (const key of transactionLocks) activeLocks.delete(key);
        transactionDepth -= 1;
      }
    },
  };

  const runner = new SystemMessageDeliveryRunnerService(
    dataSource as never,
    registry,
    new SystemMessageTemplateRendererService(),
    sender as never,
  );
  return {
    afterClaimCommit: (callback: null | ((authoritative: Store) => void)) => {
      afterClaimCommit = callback;
    },
    adapter,
    beforeExternalUpdate: (
      callback:
        | null
        | ((authoritative: Store, where: Record<string, unknown>) => void),
    ) => {
      beforeExternalUpdate = callback;
    },
    beforePreparationDeliveryRead: (
      callback: null | ((draft: Store) => void),
    ) => {
      beforePreparationDeliveryRead = callback;
    },
    externalUpdates,
    failExternalUpdates: (count: number) => {
      externalUpdateFailures = count;
    },
    getState: () => state,
    lockOrder,
    operations,
    pauseClaim: (entered: () => void, resume: Promise<void>) => {
      pauseNextClaim = { entered, resume };
    },
    queries,
    preparationClaimLocks,
    registry,
    runner,
    sender,
    senderDepths,
  };
}

async function flushPromises(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe('System message delivery runner direct preflight contracts', () => {
  it('1 records the exact top-level due/expired predicate, order, limit, and skip-locked write lock', async () => {
    const harness = setup();
    await harness.runner.runOnce(NOW);
    expect(harness.queries[0]).toMatchObject({
      lock: 'pessimistic_write',
      onLocked: 'skip_locked',
      orders: ['delivery.nextAttemptAt ASC', 'delivery.id ASC'],
      take: 1,
      topLevelBrackets: true,
    });
    expect(harness.queries[0].predicates).toEqual([
      {
        expression:
          'delivery.status IN (:...due) AND delivery.nextAttemptAt <= :now',
        parameters: {
          due: ['pending', 'retry', 'waiting_ddns'],
          now: NOW,
        },
      },
      {
        expression:
          'delivery.status = :processing AND delivery.processingLeaseUntil <= :now',
        parameters: { now: NOW, processing: 'processing' },
      },
    ]);
  });

  it('2 bounds claims at 50 and excludes no-due, future, and live-lease rows', async () => {
    const due = Array.from(
      { length: SYSTEM_MESSAGE_BATCH_SIZE + 2 },
      (_, index) =>
        delivery({
          id: `${1000 + index}`,
          publishTargetId: `${2000 + index}`,
        }),
    );
    const harness = setup({
      deliveries: [
        ...due,
        delivery({
          id: '3001',
          nextAttemptAt: new KtDateTime(NOW.getTime() + 1),
          status: 'retry',
        }),
        delivery({
          id: '3002',
          nextAttemptAt: null,
          processingLeaseUntil: new KtDateTime(NOW.getTime() + 1),
          status: 'processing',
        }),
      ],
      targets: due.map((item) =>
        target({
          id: item.publishTargetId,
          targetId: item.targetId,
        }),
      ),
    });
    expect(await harness.runner.runOnce(NOW)).toBe(SYSTEM_MESSAGE_BATCH_SIZE);
    expect(
      harness.getState().deliveries.filter((item) => item.status === 'success'),
    ).toHaveLength(SYSTEM_MESSAGE_BATCH_SIZE);
    expect(
      harness.getState().deliveries.find((item) => item.id === '3001')?.status,
    ).toBe('retry');
    expect(
      harness.getState().deliveries.find((item) => item.id === '3002')?.status,
    ).toBe('processing');
    expect(await setup({ deliveries: [] }).runner.runOnce(NOW)).toBe(0);
  });

  it('3 skips an overlapping claim lock and never claims the same live lease twice', async () => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const harness = setup({
      deliveries: [
        delivery({ id: '801', publishTargetId: '701' }),
        delivery({ id: '802', publishTargetId: '702' }),
      ],
      targets: [target(), target({ id: '702' })],
    });
    harness.pauseClaim(firstEntered.resolve, releaseFirst.promise);
    const firstRun = harness.runner.runOnce(NOW);
    await firstEntered.promise;
    const secondRun = harness.runner.runOnce(NOW);
    await flushPromises();
    releaseFirst.resolve();
    expect(await Promise.all([firstRun, secondRun])).toEqual([1, 1]);
    expect(harness.sender).toHaveProperty(
      'sendStrictPlainText',
      expect.any(Function),
    );
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledTimes(2);
    expect(
      new Set(
        harness.sender.sendStrictPlainText.mock.calls.map(
          ([input]) => input.deliveryId,
        ),
      ).size,
    ).toBe(2);
  });

  it('4 recovers only an expired processing lease with a new attempt and lease', async () => {
    const harness = setup({
      deliveries: [
        delivery({
          attemptCount: 4,
          id: '801',
          nextAttemptAt: null,
          processingLeaseUntil: new KtDateTime(NOW.getTime() - 1),
          status: 'processing',
        }),
        delivery({
          attemptCount: 8,
          id: '802',
          nextAttemptAt: null,
          processingLeaseUntil: new KtDateTime(NOW.getTime() + 1),
          status: 'processing',
        }),
      ],
    });
    expect(await harness.runner.runOnce(NOW)).toBe(1);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 5, deliveryId: '801' }),
    );
    expect(
      harness.getState().deliveries.find((item) => item.id === '802'),
    ).toMatchObject({ attemptCount: 8, status: 'processing' });
    expect(harness.operations.slice(0, 3)).toEqual([
      'claim:commit',
      'prepare:commit',
      'send',
    ]);
  });

  it.each([
    'success',
    'retry',
    'cancelled',
    'failed',
    'superseded',
    'waiting_ddns',
  ] as const)(
    '5 fences a stale owner %s result with exact id/status/attempt/lease CAS',
    async (resultKind) => {
      const harness = setup();
      if (resultKind === 'retry') {
        harness.sender.sendStrictPlainText.mockRejectedValueOnce(
          new QqbotSendAttemptError({
            code: 'onebot_timeout',
            message: 'timeout',
            retryable: true,
            sendLogId: 'new-log',
          }),
        );
      }
      if (resultKind === 'cancelled') {
        harness.getState().targets[0].enabled = false;
      }
      if (resultKind === 'failed') {
        harness.getState().deliveries[0].templateContent =
          'endpoint=${{endpoint}';
      }
      if (resultKind === 'superseded') {
        harness.adapter.resolveDelivery.mockResolvedValueOnce({
          reasonCode: 'endpoint_superseded',
          status: 'superseded',
        });
      }
      if (resultKind === 'waiting_ddns') {
        harness.adapter.resolveDelivery.mockResolvedValueOnce({
          reasonCode: 'ddns_not_synced',
          status: 'waiting_ddns',
          variables: { endpoint: 'current', port: 38213 },
        });
      }
      harness.beforeExternalUpdate((state, where) => {
        expect(Object.keys(where).sort()).toEqual([
          'attemptCount',
          'id',
          'processingLeaseUntil',
          'status',
        ]);
        expect(where).toEqual({
          attemptCount: 1,
          id: '801',
          processingLeaseUntil: new KtDateTime(
            NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS,
          ),
          status: 'processing',
        });
        const row = state.deliveries[0];
        row.attemptCount += 1;
        row.processingLeaseUntil = new KtDateTime(NOW.getTime() + 99_000);
      });
      await harness.runner.runOnce(NOW);
      expect(harness.getState().deliveries[0]).toMatchObject({
        attemptCount: 2,
        status: 'processing',
      });
    },
  );

  it('5 treats stale preparation ownership as a no-op instead of semantic cancellation', async () => {
    const harness = setup();
    harness.beforePreparationDeliveryRead((draft) => {
      draft.deliveries[0].attemptCount = 2;
      draft.deliveries[0].processingLeaseUntil = new KtDateTime(
        NOW.getTime() + 99_000,
      );
    });
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0]).toMatchObject({
      attemptCount: 2,
      lastErrorCode: 'old_error',
      status: 'processing',
    });
  });

  it('5 loses ownership when a canonical config change cancels the claimed old-identity row', async () => {
    const harness = setup();
    harness.afterClaimCommit((state) => {
      state.subscriptions[0].sourceConfig = {
        ddnsRecordId: 'new-ddns-record',
        portForwardId: RESOURCE_KEY,
      };
      Object.assign(state.deliveries[0], {
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'cancelled',
      });
    });

    await harness.runner.runOnce(NOW);

    expect(harness.adapter.resolveDelivery).not.toHaveBeenCalled();
    expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0]).toMatchObject({
      attemptCount: 1,
      lastErrorCode: 'old_error',
      processingLeaseUntil: null,
      status: 'cancelled',
    });
  });

  it('6-8 sends exact frozen input after both transactions commit and ignores current template identity', async () => {
    const harness = setup({
      bindings: [binding({ templateId: 'new-template' })],
    });
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledWith({
      attemptNumber: 1,
      deliveryId: '801',
      message: 'endpoint=pal.example.com:38213 port=38213',
      selfId: 'bot-a',
      targetId: 'group-1',
      targetType: 'group',
    });
    expect(harness.senderDepths).toEqual([0]);
    expect(harness.operations.slice(0, 3)).toEqual([
      'claim:commit',
      'prepare:commit',
      'send',
    ]);
    expect(harness.preparationClaimLocks).toEqual([false]);
    expect(harness.lockOrder).toEqual([
      'QqbotMessageEvent',
      'QqbotMessageSubscription',
      'QqbotMessagePublishBinding',
      'QqbotMessagePublishTarget',
      'QqbotAccount',
      'QqbotMessageDelivery',
    ]);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
      processingLeaseUntil: null,
      sendLogId: 'send-log-1',
      status: 'success',
    });
  });

  it.each([
    ['unknown variable', { endpoint: 'x', extra: true, port: 1 }],
    ['missing variable', { endpoint: 'x' }],
    ['null variable', { endpoint: 'x', port: null }],
    ['wrong variable type', { endpoint: 'x', port: '1' }],
  ])(
    '9 permanently rejects a %s in the frozen snapshot',
    async (_name, snapshot) => {
      const harness = setup({
        deliveries: [
          delivery({
            ...(String(_name) === 'missing variable'
              ? {
                  renderedMessage: 'endpoint=x',
                  templateContent: 'endpoint=${{endpoint}}',
                }
              : {}),
            variableSnapshot: snapshot,
          }),
        ],
      });
      await harness.runner.runOnce(NOW);
      expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
      expect(harness.getState().deliveries[0]).toMatchObject({
        lastErrorCode: 'template_invalid',
        status: 'failed',
      });
    },
  );

  it.each([
    ['invalid syntax', 'endpoint=${{endpoint}', 'irrelevant'],
    [
      'render mismatch',
      'endpoint=${{endpoint}} port=${{port}}',
      'rewritten current content',
    ],
  ])(
    '9 permanently rejects frozen %s',
    async (_name, templateContent, renderedMessage) => {
      const harness = setup({
        deliveries: [delivery({ renderedMessage, templateContent })],
      });
      await harness.runner.runOnce(NOW);
      expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
      expect(harness.getState().deliveries[0].status).toBe('failed');
    },
  );

  it('9 permanently rejects a corrupt frozen target type before configuration mismatch handling', async () => {
    const harness = setup({
      deliveries: [delivery({ targetType: 'channel' as never })],
    });
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'invalid_target_type',
      status: 'failed',
    });
  });

  it('9 validates immutable event payload before readiness and fails corrupt payload permanently', async () => {
    const harness = setup();
    harness.adapter.validateEventPayload.mockImplementationOnce(() => {
      throw new SystemMessageContractError('invalid_source_config');
    });
    await harness.runner.runOnce(NOW);
    expect(harness.adapter.resolveDelivery).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'invalid_source_config',
      status: 'failed',
    });
  });

  it('10 waits 60 seconds for DDNS while preserving the latest log', async () => {
    const harness = setup();
    harness.adapter.resolveDelivery.mockResolvedValueOnce({
      reasonCode: 'ddns_not_synced',
      status: 'waiting_ddns',
      variables: { endpoint: 'current', port: 38213 },
    });
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'ddns_not_synced',
      nextAttemptAt: new KtDateTime(
        NOW.getTime() + SYSTEM_MESSAGE_DDNS_RECHECK_MS,
      ),
      processingLeaseUntil: null,
      sendLogId: 'old-log',
      status: 'waiting_ddns',
    });
  });

  it('11 sends a due waiting row without replacing frozen variables with readiness variables', async () => {
    const harness = setup({
      deliveries: [delivery({ status: 'waiting_ddns' })],
    });
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'endpoint=pal.example.com:38213 port=38213',
      }),
    );
    expect(harness.getState().deliveries[0].status).toBe('success');
  });

  it('11 handles a due TCP NATMap waiting row through the generic source registry', async () => {
    const harness = setup(
      {
        deliveries: [delivery({ status: 'waiting_ddns' })],
        events: [
          event({
            payload: {
              publicIpv4: '203.0.113.10',
              publicPort: 45_101,
              tcpChannelId: RESOURCE_KEY,
            },
            sourceKey: TCP_SOURCE_KEY,
          }),
        ],
        subscriptions: [
          subscription({
            sourceConfig: {
              ddnsRecordId: '9007199254740995',
              tcpChannelId: RESOURCE_KEY,
            },
            sourceKey: TCP_SOURCE_KEY,
          }),
        ],
      },
      TCP_SOURCE_KEY,
    );

    await harness.runner.runOnce(NOW);

    expect(harness.adapter.resolveDelivery).toHaveBeenCalledTimes(1);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledTimes(1);
    expect(harness.getState().deliveries[0].status).toBe('success');
  });

  it.each([
    ['endpoint_port_changed', 'superseded'],
    ['endpoint_ipv4_changed', 'superseded'],
    ['endpoint_lease_expired', 'superseded'],
  ] as const)(
    '12 persists adapter %s as superseded',
    async (reasonCode, status) => {
      const harness = setup();
      harness.adapter.resolveDelivery.mockResolvedValueOnce({
        reasonCode,
        status,
      });
      await harness.runner.runOnce(NOW);
      expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
      expect(harness.getState().deliveries[0]).toMatchObject({
        lastErrorCode: reasonCode,
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'superseded',
      });
    },
  );

  it.each([
    ['missing subscription', { subscriptions: [] }],
    [
      'disabled subscription',
      { subscriptions: [subscription({ enabled: false })] },
    ],
    ['deleted binding', { bindings: [binding({ isDeleted: true })] }],
    [
      'mismatched binding',
      { bindings: [binding({ subscriptionId: 'other' })] },
    ],
    ['disabled target', { targets: [target({ enabled: false })] }],
    ['changed target', { targets: [target({ targetId: 'other' })] }],
  ])('13 cancels %s configuration', async (_name, seed) => {
    const harness = setup(seed);
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(harness.getState().deliveries[0].status).toBe('cancelled');
  });

  it.each([
    ['missing account', { accounts: [] }],
    ['disabled account', { accounts: [account({ enabled: false })] }],
    ['deleted account', { accounts: [account({ isDeleted: true })] }],
    ['binding self mismatch', { bindings: [binding({ selfId: 'bot-b' })] }],
    ['account self mismatch', { accounts: [account({ selfId: 'bot-b' })] }],
  ])(
    '14 cancels %s without a default-account fallback',
    async (_name, seed) => {
      const harness = setup(seed);
      await harness.runner.runOnce(NOW);
      expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
      expect(harness.getState().deliveries[0].status).toBe('cancelled');
    },
  );

  it('15 sends with the exact enabled account despite runtime-offline fields and retries disconnect', async () => {
    const harness = setup({
      accounts: [
        account({
          connectStatus: 'offline',
          oneBotStatus: 'offline',
        }),
      ],
    });
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_disconnected',
        message: 'runtime offline',
        retryable: true,
        sendLogId: null,
      }),
    );
    await harness.runner.runOnce(NOW);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledWith(
      expect.objectContaining({ selfId: 'bot-a' }),
    );
    expect(harness.getState().deliveries[0].status).toBe('retry');
  });

  it.each([
    ['onebot_rejected', 'latest-log'],
    ['invalid_target_type', null],
  ])(
    '16 permanently fails typed %s and retains the latest available log',
    async (code, sendLogId) => {
      const harness = setup();
      harness.sender.sendStrictPlainText.mockRejectedValueOnce(
        new QqbotSendAttemptError({
          code,
          message: 'safe rejection',
          retryable: false,
          sendLogId,
        }),
      );
      await harness.runner.runOnce(NOW);
      expect(harness.getState().deliveries[0]).toMatchObject({
        lastErrorCode: code,
        sendLogId: sendLogId ?? 'old-log',
        status: 'failed',
      });
    },
  );

  it('16 retries the exact permanent outcome after one final persistence failure', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_rejected',
        message: 'unsafe raw permanent rejection',
        retryable: false,
        sendLogId: 'latest-log',
      }),
    );
    harness.failExternalUpdates(1);

    await harness.runner.runOnce(NOW);

    expect(harness.externalUpdates).toHaveLength(2);
    expect(harness.externalUpdates[1]).toEqual(harness.externalUpdates[0]);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'onebot_rejected',
      lastErrorMessage: 'OneBot rejected the send action',
      nextAttemptAt: null,
      processingLeaseUntil: null,
      sendLogId: 'latest-log',
      status: 'failed',
    });

    await harness.runner.runOnce(new Date(NOW.getTime() + 10_000));
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledTimes(1);
  });

  it('6 retries the exact successful outcome after one final persistence failure', async () => {
    const harness = setup();
    harness.failExternalUpdates(1);

    await harness.runner.runOnce(NOW);

    expect(harness.externalUpdates).toHaveLength(2);
    expect(harness.externalUpdates[1]).toEqual(harness.externalUpdates[0]);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
      processingLeaseUntil: null,
      sendLogId: 'send-log-1',
      status: 'success',
    });
  });

  it('17 retries the exact typed retry outcome after one final persistence failure', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_timeout',
        message: 'unsafe raw timeout',
        retryable: true,
        sendLogId: 'retry-log',
      }),
    );
    harness.failExternalUpdates(1);

    await harness.runner.runOnce(NOW);

    expect(harness.externalUpdates).toHaveLength(2);
    expect(harness.externalUpdates[1]).toEqual(harness.externalUpdates[0]);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'onebot_timeout',
      lastErrorMessage: 'OneBot send timed out',
      nextAttemptAt: new KtDateTime(NOW.getTime() + 10_000),
      processingLeaseUntil: null,
      sendLogId: 'retry-log',
      status: 'retry',
    });
  });

  it('17 retries a typed first failure after 10 seconds with exact safe details', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_timeout',
        message: 'OneBot action timeout',
        retryable: true,
        sendLogId: '90001',
      }),
    );
    await harness.runner.runOnce(NOW);
    expect(harness.getState().deliveries[0]).toMatchObject({
      attemptCount: 1,
      lastErrorCode: 'onebot_timeout',
      lastErrorMessage: 'OneBot send timed out',
      nextAttemptAt: new KtDateTime(NOW.getTime() + 10_000),
      processingLeaseUntil: null,
      sendLogId: '90001',
      status: 'retry',
    });
  });

  it('17 never persists arbitrary text carried by an explicitly typed strict-send error', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_disconnected',
        message:
          'password=delivery-secret SELECT * FROM qqbot_private connection=mysql://root@db',
        retryable: true,
        sendLogId: '90002',
      }),
    );

    await harness.runner.runOnce(NOW);

    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'onebot_disconnected',
      lastErrorMessage: 'OneBot connection unavailable',
      sendLogId: '90002',
      status: 'retry',
    });
    expect(JSON.stringify(harness.getState().deliveries[0])).not.toContain(
      'delivery-secret',
    );
  });

  it('18 caps exponential backoff at fifteen minutes', async () => {
    const harness = setup({
      deliveries: [delivery({ attemptCount: 19 })],
    });
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_timeout',
        message: 'timeout',
        retryable: true,
        sendLogId: null,
      }),
    );
    await harness.runner.runOnce(NOW);
    expect(harness.getState().deliveries[0].nextAttemptAt).toEqual(
      new KtDateTime(NOW.getTime() + 15 * 60_000),
    );
    expect(deliveryRetryDelayMs(20)).toBe(15 * 60_000);
  });

  it.each([
    ['exact expiry', NOW.getTime(), 'failed'],
    ['after expiry', NOW.getTime() - 1, 'failed'],
    ['retry reaches expiry', NOW.getTime() + 10_000, 'failed'],
    ['retry remains inside', NOW.getTime() + 10_001, 'retry'],
  ] as const)(
    '19 enforces the event-based 24h boundary: %s',
    async (_name, expiresAt, status) => {
      const harness = setup({
        deliveries: [delivery({ expiresAt: new KtDateTime(expiresAt) })],
      });
      harness.sender.sendStrictPlainText.mockRejectedValueOnce(
        new QqbotSendAttemptError({
          code: 'onebot_timeout',
          message: 'timeout',
          retryable: true,
          sendLogId: null,
        }),
      );
      await harness.runner.runOnce(NOW);
      expect(harness.getState().deliveries[0].status).toBe(status);
      if (expiresAt <= NOW.getTime())
        expect(harness.sender.sendStrictPlainText).not.toHaveBeenCalled();
    },
  );

  it('20 retries an ambiguous timeout with the same delivery ID and next attempt number', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText
      .mockRejectedValueOnce(
        new QqbotSendAttemptError({
          code: 'onebot_timeout',
          message: 'ambiguous external result',
          retryable: true,
          sendLogId: 'attempt-log-1',
        }),
      )
      .mockResolvedValueOnce({ logId: 'attempt-log-2' });
    await harness.runner.runOnce(NOW);
    await harness.runner.runOnce(new Date(NOW.getTime() + 10_000));
    expect(harness.sender.sendStrictPlainText.mock.calls).toEqual([
      [expect.objectContaining({ attemptNumber: 1, deliveryId: '801' })],
      [expect.objectContaining({ attemptNumber: 2, deliveryId: '801' })],
    ]);
    expect(harness.getState().deliveries[0]).toMatchObject({
      attemptCount: 2,
      sendLogId: 'attempt-log-2',
      status: 'success',
    });
  });

  it('21 sanitizes an untyped infrastructure failure without persisting raw error content', async () => {
    const harness = setup();
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new Error('password=secret\nSELECT * FROM private_table'),
    );
    await harness.runner.runOnce(NOW);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'delivery_transient_error',
      lastErrorMessage: 'delivery transport unavailable',
      status: 'retry',
    });
    expect(JSON.stringify(harness.getState().deliveries[0])).not.toContain(
      'secret',
    );
  });

  it('21 retries registry and adapter infrastructure errors instead of classifying them as corrupt payload', async () => {
    const harness = setup();
    harness.adapter.resolveDelivery.mockRejectedValueOnce(
      new SystemMessageContractError('adapter_dependency_unavailable'),
    );
    await harness.runner.runOnce(NOW);
    expect(harness.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'delivery_transient_error',
      status: 'retry',
    });

    const unavailable = setup();
    unavailable.registry.unregister(SOURCE_KEY, unavailable.adapter);
    await unavailable.runner.runOnce(NOW);
    expect(unavailable.getState().deliveries[0]).toMatchObject({
      lastErrorCode: 'delivery_transient_error',
      status: 'retry',
    });
  });

  it('22 lets a sibling succeed after another target receives a typed send failure', async () => {
    const harness = setup({
      deliveries: [
        delivery({ id: '801', publishTargetId: '701' }),
        delivery({ id: '802', publishTargetId: '702' }),
      ],
      targets: [target(), target({ id: '702' })],
    });
    harness.sender.sendStrictPlainText.mockRejectedValueOnce(
      new QqbotSendAttemptError({
        code: 'onebot_timeout',
        message: 'timeout',
        retryable: true,
        sendLogId: 'failed-log',
      }),
    );
    expect(await harness.runner.runOnce(NOW)).toBe(2);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledTimes(2);
    expect(harness.getState().deliveries.map((item) => item.status)).toEqual([
      'retry',
      'success',
    ]);
  });

  it('22 isolates a failed final persistence path so a sibling target still succeeds', async () => {
    const harness = setup({
      deliveries: [
        delivery({ id: '801', publishTargetId: '701' }),
        delivery({ id: '802', publishTargetId: '702' }),
      ],
      targets: [target(), target({ id: '702' })],
    });
    harness.failExternalUpdates(2);
    expect(await harness.runner.runOnce(NOW)).toBe(2);
    expect(harness.sender.sendStrictPlainText).toHaveBeenCalledTimes(2);
    expect(harness.externalUpdates.slice(0, 2)).toEqual([
      harness.externalUpdates[0],
      harness.externalUpdates[0],
    ]);
    expect(
      harness.getState().deliveries.find((item) => item.id === '801'),
    ).toMatchObject({
      lastErrorCode: 'old_error',
      processingLeaseUntil: new KtDateTime(
        NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS,
      ),
      sendLogId: 'old-log',
      status: 'processing',
    });
    expect(
      harness.getState().deliveries.find((item) => item.id === '802')?.status,
    ).toBe('success');
  });

  it('uses the exact 30-second claim lease and clears it on every persisted result', async () => {
    const harness = setup();
    const claimLease: Array<Date | null> = [];
    harness.beforeExternalUpdate((state) => {
      claimLease.push(state.deliveries[0].processingLeaseUntil);
    });
    await harness.runner.runOnce(NOW);
    expect(claimLease[0]).toEqual(
      new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS),
    );
    expect(harness.getState().deliveries[0].processingLeaseUntil).toBeNull();
  });

  it('samples a fresh production clock for each claim after a slow prior send', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const harness = setup({
        deliveries: [
          delivery({ id: '801', publishTargetId: '701' }),
          delivery({ id: '802', publishTargetId: '702' }),
        ],
        targets: [target(), target({ id: '702' })],
      });
      const observedLeases: Array<Date | null> = [];
      harness.beforeExternalUpdate((state) => {
        const processing = state.deliveries.find(
          (item) => item.status === 'processing',
        );
        observedLeases.push(processing?.processingLeaseUntil ?? null);
      });
      harness.sender.sendStrictPlainText.mockImplementation(async () => {
        if (harness.sender.sendStrictPlainText.mock.calls.length === 1) {
          jest.setSystemTime(NOW.getTime() + 31_000);
        }
        return { logId: 'send-log' };
      });

      await harness.runner.runOnce();

      expect(observedLeases).toEqual([
        new KtDateTime(NOW.getTime() + SYSTEM_MESSAGE_LEASE_MS),
        new KtDateTime(NOW.getTime() + 31_000 + SYSTEM_MESSAGE_LEASE_MS),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('schedules a production retry from the fresh post-I/O clock', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const harness = setup();
      harness.sender.sendStrictPlainText.mockImplementationOnce(async () => {
        jest.setSystemTime(NOW.getTime() + 31_000);
        throw new QqbotSendAttemptError({
          code: 'onebot_timeout',
          message: 'raw timeout detail',
          retryable: true,
          sendLogId: 'slow-log',
        });
      });

      await harness.runner.runOnce();

      expect(harness.getState().deliveries[0].nextAttemptAt).toEqual(
        new KtDateTime(NOW.getTime() + 41_000),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('System message coordinator direct lifecycle contracts', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('33 coalesces wakes without overlap and performs exactly one necessary follow-up', async () => {
    const first = deferred();
    let active = 0;
    let maximumActive = 0;
    const fanout = {
      runOnce: jest.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (fanout.runOnce.mock.calls.length === 1) await first.promise;
        active -= 1;
        return 0;
      }),
    };
    const deliveryRunner = { runOnce: jest.fn().mockResolvedValue(0) };
    const coordinator = new SystemMessageDeliveryCoordinatorService(
      {} as never,
      fanout as never,
      deliveryRunner as never,
    );
    coordinator.requestDrain();
    await flushPromises();
    coordinator.requestDrain();
    coordinator.requestDrain();
    first.resolve();
    await flushPromises();
    expect(maximumActive).toBe(1);
    expect(fanout.runOnce).toHaveBeenCalledTimes(2);
    expect(deliveryRunner.runOnce).toHaveBeenCalledTimes(2);
  });

  it('34 runs fan-out before delivery on every pass and isolates either rejection', async () => {
    const calls: string[] = [];
    const fanout = {
      runOnce: jest
        .fn()
        .mockImplementationOnce(async () => {
          calls.push('fanout-1');
          throw new Error('fanout failed');
        })
        .mockImplementationOnce(async () => {
          calls.push('fanout-2');
          return 0;
        }),
    };
    const deliveryRunner = {
      runOnce: jest
        .fn()
        .mockImplementationOnce(async () => {
          calls.push('delivery-1');
          return 0;
        })
        .mockImplementationOnce(async () => {
          calls.push('delivery-2');
          throw new Error('delivery failed');
        }),
    };
    const coordinator = new SystemMessageDeliveryCoordinatorService(
      {} as never,
      fanout as never,
      deliveryRunner as never,
    );
    coordinator.requestDrain();
    await flushPromises();
    coordinator.requestDrain();
    await flushPromises();
    expect(calls).toEqual(['fanout-1', 'delivery-1', 'fanout-2', 'delivery-2']);
  });

  it('35 immediately drains a full bounded batch and stops below 50 without another wake', async () => {
    const fanout = {
      runOnce: jest
        .fn()
        .mockResolvedValueOnce(SYSTEM_MESSAGE_BATCH_SIZE)
        .mockResolvedValueOnce(SYSTEM_MESSAGE_BATCH_SIZE - 1),
    };
    const deliveryRunner = { runOnce: jest.fn().mockResolvedValue(0) };
    const coordinator = new SystemMessageDeliveryCoordinatorService(
      {} as never,
      fanout as never,
      deliveryRunner as never,
    );
    coordinator.requestDrain();
    await flushPromises();
    expect(fanout.runOnce).toHaveBeenCalledTimes(2);
    expect(deliveryRunner.runOnce).toHaveBeenCalledTimes(2);
  });

  it('36-37 installs one unref interval and a post-module-init zero-delay startup wake', async () => {
    jest.useFakeTimers();
    const fanout = { runOnce: jest.fn().mockResolvedValue(0) };
    const deliveryRunner = { runOnce: jest.fn().mockResolvedValue(0) };
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const coordinator = new SystemMessageDeliveryCoordinatorService(
      {} as never,
      fanout as never,
      deliveryRunner as never,
    );
    coordinator.onModuleInit();
    expect(fanout.runOnce).not.toHaveBeenCalled();
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(intervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
    );
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(
      (intervalSpy.mock.results[0].value as NodeJS.Timeout).hasRef?.(),
    ).toBe(false);
    expect(
      (timeoutSpy.mock.results[0].value as NodeJS.Timeout).hasRef?.(),
    ).toBe(false);
    expect(jest.getTimerCount()).toBe(2);
    jest.advanceTimersByTime(0);
    await flushPromises();
    expect(fanout.runOnce).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SYSTEM_MESSAGE_SCAN_INTERVAL_MS);
    await flushPromises();
    expect(fanout.runOnce).toHaveBeenCalledTimes(2);
    await coordinator.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    'wake before destroy',
    'wake during active pass',
    'wake after destroy',
  ])(
    '38 clears timers, awaits active work, and suppresses post-destroy calls: %s',
    async (race) => {
      jest.useFakeTimers();
      const active = deferred();
      const fanout = {
        runOnce: jest.fn(async () => {
          if (fanout.runOnce.mock.calls.length === 1) await active.promise;
          return 0;
        }),
      };
      const deliveryRunner = { runOnce: jest.fn().mockResolvedValue(0) };
      const coordinator = new SystemMessageDeliveryCoordinatorService(
        {} as never,
        fanout as never,
        deliveryRunner as never,
      );
      coordinator.onModuleInit();
      if (race === 'wake after destroy') {
        await coordinator.onModuleDestroy();
        coordinator.requestDrain();
        jest.runAllTimers();
        await flushPromises();
        expect(fanout.runOnce).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
        return;
      }
      coordinator.requestDrain();
      if (race !== 'wake before destroy') {
        await flushPromises();
        if (race === 'wake during active pass') coordinator.requestDrain();
      }
      const destroyed = coordinator.onModuleDestroy();
      let destroySettled = false;
      void destroyed.then(() => {
        destroySettled = true;
      });
      await Promise.resolve();
      if (fanout.runOnce.mock.calls.length > 0)
        expect(destroySettled).toBe(false);
      active.resolve();
      await destroyed;
      coordinator.requestDrain();
      jest.runAllTimers();
      await flushPromises();
      expect(fanout.runOnce).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('38 suppresses a wake queued after loop completion but before promise finally', async () => {
    jest.useFakeTimers();
    let destroyPromise: Promise<void> | undefined;
    const fanout = { runOnce: jest.fn().mockResolvedValue(0) };
    const deliveryRunner = {
      runOnce: jest.fn(
        () =>
          new Promise<number>((resolve) => {
            queueMicrotask(() => {
              resolve(0);
              queueMicrotask(() => {
                queueMicrotask(() => {
                  coordinator.requestDrain();
                  destroyPromise = coordinator.onModuleDestroy();
                });
              });
            });
          }),
      ),
    };
    const coordinator = new SystemMessageDeliveryCoordinatorService(
      {} as never,
      fanout as never,
      deliveryRunner as never,
    );
    coordinator.onModuleInit();
    coordinator.requestDrain();
    await flushPromises(16);
    await destroyPromise;
    jest.runAllTicks();
    await flushPromises();
    expect(fanout.runOnce).toHaveBeenCalledTimes(1);
    expect(deliveryRunner.runOnce).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
