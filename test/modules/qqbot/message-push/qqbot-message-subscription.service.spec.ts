import { createHash } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { KtDateTime } from '../../../../src/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
} from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { QqbotMessageSubscriptionService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-subscription.service';
import { NetworkStunMessageSourceAdapter } from '../../../../src/modules/admin/platform-config/network-management/infrastructure/integration/network-stun-message-source.adapter';
import { NetworkDdnsRecord } from '../../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForward } from '../../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const NOW = new KtDateTime('2026-07-24 08:09:10');
const CONFIG = {
  ddnsRecordId: '2041700000000000002',
  portForwardId: '2041700000000000001',
};

function subscription(
  overrides: Partial<QqbotMessageSubscription> = {},
): QqbotMessageSubscription {
  const sourceConfig = { ...CONFIG };
  const digest = digestFor(sourceConfig);
  return {
    activeKey: `${SOURCE_KEY}:${digest}`,
    createId: jest.fn(),
    createTime: NOW,
    enabled: true,
    id: '100',
    isDeleted: false,
    name: '端口提醒',
    remark: null,
    sourceConfig,
    sourceConfigDigest: digest,
    sourceKey: SOURCE_KEY,
    updateTime: NOW,
    ...overrides,
  };
}

function digestFor(config: Record<string, string>): string {
  const json = JSON.stringify(
    Object.fromEntries(
      Object.entries(config).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
  return createHash('sha256').update(json).digest('hex');
}

function likeValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { _value?: unknown };
  return typeof candidate._value === 'string' ? candidate._value : undefined;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function adapter(
  inspect = {
    invalidReasonCode: null,
    sourceSummary: '帕鲁新世界 · pal.example.com',
    valid: true,
  },
): jest.Mocked<SystemMessageSourceAdapter> {
  return {
    definition: {
      description: 'STUN 映射端口变化',
      displayName: 'STUN 端口变化',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [
        {
          key: 'portForwardId',
          label: '端口转发',
          optionCollection: 'portForwards',
          required: true,
          type: 'select',
        },
        {
          dependsOn: 'portForwardId',
          key: 'ddnsRecordId',
          label: 'IPv4 DDNS',
          optionCollection: 'ddnsRecords',
          required: true,
          type: 'select',
        },
      ],
      variables: [],
      version: 1,
    },
    eventResourceKey: jest.fn(),
    inspectSubscription: jest.fn(async (config: Record<string, unknown>) => {
      void config;
      return inspect;
    }),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(async (input: unknown) => {
      void input;
      return {
        canonicalConfig: { ...CONFIG },
        resourceKey: CONFIG.portForwardId,
        sourceSummary: '忽略：服务必须使用实时 inspect 结果',
      };
    }),
    resolveDelivery: jest.fn(),
    subscriptionResourceKey: jest.fn(),
    validateEventPayload: jest.fn(),
  };
}

function registry(
  source: SystemMessageSourceAdapter,
): SystemMessageSourceRegistry {
  const value = new SystemMessageSourceRegistry();
  value.register(source);
  return value;
}

function setup(
  items: QqbotMessageSubscription[] = [],
  source: SystemMessageSourceAdapter = adapter(),
  bindings: Array<{ isDeleted: boolean; subscriptionId: string }> = [],
  additionalSources: SystemMessageSourceAdapter[] = [],
) {
  let createSequence = 1000;
  const subscriptionRepository = {
    create: jest.fn((input) =>
      subscription({ id: String(createSequence++), ...input }),
    ),
    findAndCount: jest.fn(
      async ({
        skip = 0,
        take = items.length,
        where,
      }: {
        skip?: number;
        take?: number;
        where: FindOptionsWhere<QqbotMessageSubscription>;
      }) => {
        const name = likeValue(where.name)?.slice(1, -1);
        const matched = items.filter((item) => {
          if (item.isDeleted !== where.isDeleted) return false;
          if (where.enabled !== undefined && item.enabled !== where.enabled) {
            return false;
          }
          if (where.sourceKey && item.sourceKey !== where.sourceKey)
            return false;
          return !name || item.name.includes(name);
        });
        return [matched.slice(skip, skip + take), matched.length];
      },
    ),
    findOne: jest.fn(async (options) => {
      const where = options.where as FindOptionsWhere<QqbotMessageSubscription>;
      const candidates = items.filter((item) => {
        if (where.id !== undefined && item.id !== where.id) return false;
        if (
          where.activeKey !== undefined &&
          item.activeKey !== where.activeKey
        ) {
          return false;
        }
        if (
          where.sourceKey !== undefined &&
          item.sourceKey !== where.sourceKey
        ) {
          return false;
        }
        if (
          where.sourceConfigDigest !== undefined &&
          item.sourceConfigDigest !== where.sourceConfigDigest
        ) {
          return false;
        }
        return (
          where.isDeleted === undefined || item.isDeleted === where.isDeleted
        );
      });
      if (options.order?.updateTime === 'DESC') {
        candidates.sort((left, right) => {
          const time = String(right.updateTime).localeCompare(
            String(left.updateTime),
          );
          return time || right.id.localeCompare(left.id);
        });
      }
      return candidates[0] ?? null;
    }),
    save: jest.fn(async (item: QqbotMessageSubscription) => {
      const existing = items.find((candidate) => candidate.id === item.id);
      if (existing) Object.assign(existing, item);
      else items.push(item);
      return item;
    }),
  } as unknown as jest.Mocked<Repository<QqbotMessageSubscription>>;
  const bindingRepository = {
    count: jest.fn(
      async ({ where: { isDeleted, subscriptionId } }) =>
        bindings.filter(
          (binding) =>
            binding.isDeleted === isDeleted &&
            binding.subscriptionId === subscriptionId,
        ).length,
    ),
  } as unknown as jest.Mocked<Repository<QqbotMessagePublishBinding>>;
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessageSubscription) return subscriptionRepository;
      if (entity === QqbotMessagePublishBinding) return bindingRepository;
      if (entity === QqbotMessageDelivery) {
        return { update: jest.fn(async () => ({ affected: 0 })) };
      }
      throw new Error('unexpected repository');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  Object.assign(subscriptionRepository, {
    manager: { transaction: jest.fn((callback) => callback(manager)) },
  });
  const sourceRegistry = registry(source);
  additionalSources.forEach((item) => sourceRegistry.register(item));
  const service = new QqbotMessageSubscriptionService(
    subscriptionRepository,
    sourceRegistry,
  );
  return {
    bindingRepository,
    items,
    manager,
    service,
    source,
    sourceRegistry,
    subscriptionRepository,
  };
}

function setupConcurrentCreateRace(historical?: QqbotMessageSubscription) {
  const items = historical ? [historical] : [];
  const bothActiveChecks = deferred();
  const bothHistoricalLookups = deferred();
  const contenderRequested = deferred();
  const historicalRowReleased = deferred();
  let activeChecks = 0;
  let historicalLookups = 0;
  let historicalLockAttempts = 0;
  let createSequence = 1000;
  const subscriptionRepository = {
    create: jest.fn((input) =>
      subscription({ id: String(createSequence++), ...input }),
    ),
    findOne: jest.fn(async (options) => {
      const where = options.where as FindOptionsWhere<QqbotMessageSubscription>;
      if (where.activeKey !== undefined) {
        if (options.lock?.mode === 'pessimistic_write') {
          throw { code: 'ER_LOCK_DEADLOCK', errno: 1213 };
        }
        activeChecks += 1;
        if (activeChecks === 2) bothActiveChecks.resolve();
        await bothActiveChecks.promise;
        return null;
      }
      if (
        where.sourceConfigDigest !== undefined &&
        where.sourceKey !== undefined
      ) {
        if (options.lock?.mode === 'pessimistic_write') {
          throw { code: 'ER_LOCK_DEADLOCK', errno: 1213 };
        }
        historicalLookups += 1;
        if (historicalLookups === 2) bothHistoricalLookups.resolve();
        await bothHistoricalLookups.promise;
        return (
          items
            .filter(
              (item) =>
                item.isDeleted &&
                item.sourceConfigDigest === where.sourceConfigDigest &&
                item.sourceKey === where.sourceKey,
            )
            .sort((left, right) => {
              const time = String(right.updateTime).localeCompare(
                String(left.updateTime),
              );
              return time || right.id.localeCompare(left.id);
            })[0] ?? null
        );
      }
      if (where.id !== undefined && where.isDeleted === true) {
        if (options.lock?.mode !== 'pessimistic_write') {
          throw new Error('historical candidate must be locked by primary key');
        }
        historicalLockAttempts += 1;
        if (historicalLockAttempts === 1) {
          await contenderRequested.promise;
        } else {
          contenderRequested.resolve();
          await historicalRowReleased.promise;
        }
        return (
          items.find(
            (item) => item.id === where.id && item.isDeleted === true,
          ) ?? null
        );
      }
      throw new Error('unexpected subscription lookup');
    }),
    save: jest.fn(async (item: QqbotMessageSubscription) => {
      const duplicate = items.find(
        (candidate) =>
          candidate.id !== item.id &&
          !candidate.isDeleted &&
          candidate.activeKey === item.activeKey,
      );
      if (duplicate) throw { code: 'ER_DUP_ENTRY', errno: 1062 };
      const existing = items.find((candidate) => candidate.id === item.id);
      if (existing) {
        Object.assign(existing, item);
        historicalRowReleased.resolve();
      } else {
        items.push(item);
      }
      return item;
    }),
  } as unknown as jest.Mocked<Repository<QqbotMessageSubscription>>;
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessageSubscription) return subscriptionRepository;
      throw new Error('unexpected repository');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  Object.assign(subscriptionRepository, {
    manager: { transaction: jest.fn((callback) => callback(manager)) },
  });
  return {
    items,
    service: new QqbotMessageSubscriptionService(
      subscriptionRepository,
      registry(adapter()),
    ),
    subscriptionRepository,
  };
}

async function runConcurrentCreates(
  service: QqbotMessageSubscriptionService,
): Promise<unknown[]> {
  const input = {
    enabled: true,
    name: '并发订阅',
    sourceConfig: CONFIG,
    sourceKey: SOURCE_KEY,
  };
  return Promise.all([
    service.create(input).catch((error: unknown) => error),
    service.create(input).catch((error: unknown) => error),
  ]);
}

describe('QqbotMessageSubscriptionService', () => {
  it('uses sorted allowlisted config JSON for the active natural key', async () => {
    const source = adapter();
    source.normalizeSubscriptionConfig.mockResolvedValue({
      canonicalConfig: {
        portForwardId: CONFIG.portForwardId,
        ddnsRecordId: CONFIG.ddnsRecordId,
      },
      resourceKey: CONFIG.portForwardId,
      sourceSummary: 'ignored',
    });
    const { service, subscriptionRepository } = setup([], source);

    await expect(
      service.create({
        enabled: true,
        name: '帕鲁端口变更',
        remark: '',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(expect.objectContaining({ sourceConfig: CONFIG }));

    const saved = subscriptionRepository.save.mock.calls[0][0];
    const expectedDigest = digestFor(CONFIG);
    expect(saved.sourceConfig).toEqual(CONFIG);
    expect(saved.sourceConfigDigest).toBe(expectedDigest);
    expect(saved.activeKey).toBe(`${SOURCE_KEY}:${expectedDigest}`);
    expect(source.normalizeSubscriptionConfig).toHaveBeenCalledWith({
      ...CONFIG,
    });
  });

  it('rejects source config fields that are missing, unknown, or non-string', async () => {
    const { service, source } = setup();

    for (const sourceConfig of [
      { portForwardId: CONFIG.portForwardId },
      { ...CONFIG, unexpected: 'must-reject' },
      { ...CONFIG, ddnsRecordId: 2041700000000000002 },
    ]) {
      await expect(
        service.create({
          enabled: true,
          name: '非法配置',
          sourceConfig,
          sourceKey: SOURCE_KEY,
        }),
      ).rejects.toMatchObject({ code: 'invalid_source_config' });
    }
    expect(source.normalizeSubscriptionConfig).not.toHaveBeenCalled();
  });

  it('returns Vben HTTP 409 for an active duplicate and a duplicate-key create race', async () => {
    const existing = subscription();
    const { service } = setup([existing]);

    await expect(
      service.create({
        enabled: true,
        name: '重复',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(
      service.create({
        enabled: true,
        name: '重复',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.not.toBeInstanceOf(SystemMessageContractError);

    const race = setup();
    race.subscriptionRepository.save.mockRejectedValueOnce({
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    await expect(
      race.service.create({
        enabled: true,
        name: '竞态',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toBeInstanceOf(HttpException);
    race.subscriptionRepository.save.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      race.service.create({
        enabled: true,
        name: '故障',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('lets the unique key settle concurrent creates for a previously unseen natural key', async () => {
    const { items, service, subscriptionRepository } =
      setupConcurrentCreateRace();

    const results = await runConcurrentCreates(service);
    const failures = results.filter((result) => result instanceof Error);
    const successes = results.filter((result) => !(result instanceof Error));

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(HttpException);
    expect(failures[0]).toMatchObject({ status: HttpStatus.CONFLICT });
    expect(failures[0]).not.toMatchObject({ errno: 1213 });
    expect(items.filter((item) => !item.isDeleted)).toHaveLength(1);
    for (const [options] of subscriptionRepository.findOne.mock.calls) {
      const where = options.where as FindOptionsWhere<QqbotMessageSubscription>;
      if (
        where.activeKey !== undefined ||
        where.sourceConfigDigest !== undefined
      ) {
        expect(options.lock).toBeUndefined();
      }
    }
  });

  it('locks only the selected history row before one concurrent revival wins', async () => {
    const historical = subscription({
      activeKey: null,
      id: '102',
      isDeleted: true,
    });
    const { items, service, subscriptionRepository } =
      setupConcurrentCreateRace(historical);

    const results = await runConcurrentCreates(service);
    const failures = results.filter((result) => result instanceof Error);
    const successes = results.filter((result) => !(result instanceof Error));

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(HttpException);
    expect(failures[0]).toMatchObject({ status: HttpStatus.CONFLICT });
    expect(failures[0]).not.toMatchObject({ errno: 1213 });
    expect(items).toEqual([
      expect.objectContaining({ id: '102', isDeleted: false }),
    ]);
    const candidateLocks = subscriptionRepository.findOne.mock.calls.filter(
      ([options]) => options.lock?.mode === 'pessimistic_write',
    );
    expect(candidateLocks).toHaveLength(2);
    for (const [options] of candidateLocks) {
      expect(options.where).toEqual({ id: '102', isDeleted: true });
    }
  });

  it('soft deletes safely and revives the newest matching historical row with its original ID', async () => {
    const older = subscription({
      activeKey: null,
      id: '101',
      isDeleted: true,
      updateTime: new KtDateTime('2026-07-23 08:09:10'),
    });
    const newest = subscription({
      activeKey: null,
      enabled: false,
      id: '102',
      isDeleted: true,
      updateTime: NOW,
    });
    const { items, service, subscriptionRepository } = setup([older, newest]);

    await expect(
      service.create({
        enabled: true,
        name: '复活',
        remark: '说明',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: '102', name: '复活', remark: '说明' }),
    );
    expect(newest).toEqual(
      expect.objectContaining({ enabled: true, isDeleted: false }),
    );
    expect(older.isDeleted).toBe(true);

    await expect(service.remove('102')).resolves.toBe(true);
    expect(items.find((item) => item.id === '102')).toEqual(
      expect.objectContaining({
        activeKey: null,
        enabled: false,
        isDeleted: true,
      }),
    );
    expect(subscriptionRepository.findOne).toHaveBeenLastCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '102', isDeleted: false },
    });
  });

  it('updates the same ID while rejecting another active natural key', async () => {
    const first = subscription({ id: '100' });
    const secondConfig = {
      ddnsRecordId: '2041700000000000004',
      portForwardId: '2041700000000000003',
    };
    const second = subscription({
      activeKey: `${SOURCE_KEY}:${digestFor(secondConfig)}`,
      id: '101',
      sourceConfig: secondConfig,
      sourceConfigDigest: digestFor(secondConfig),
    });
    const source = adapter();
    const { service } = setup([first, second], source);

    source.normalizeSubscriptionConfig.mockResolvedValueOnce({
      canonicalConfig: secondConfig,
      resourceKey: secondConfig.portForwardId,
      sourceSummary: 'other',
    });
    await expect(
      service.update('100', {
        enabled: true,
        name: '冲突',
        sourceConfig: secondConfig,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    source.normalizeSubscriptionConfig.mockResolvedValueOnce({
      canonicalConfig: CONFIG,
      resourceKey: CONFIG.portForwardId,
      sourceSummary: 'current',
    });
    await expect(
      service.update('100', {
        enabled: false,
        name: '更新',
        remark: '  新说明 ',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        enabled: false,
        id: '100',
        name: '更新',
        remark: '新说明',
      }),
    );
  });

  it('maps duplicate-key update races to Vben HTTP 409 and propagates other save failures', async () => {
    const duplicateKeyRace = setup([subscription()]);
    duplicateKeyRace.subscriptionRepository.save.mockRejectedValueOnce({
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    await expect(
      duplicateKeyRace.service.update('100', {
        enabled: true,
        name: '更新竞态',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    const infrastructureFailure = new Error('database unavailable');
    const persistenceFailure = setup([subscription()]);
    persistenceFailure.subscriptionRepository.save.mockRejectedValueOnce(
      infrastructureFailure,
    );
    await expect(
      persistenceFailure.service.update('100', {
        enabled: true,
        name: '更新故障',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toBe(infrastructureFailure);
  });

  it('rejects opposite active-key updates as conflicts without taking a second write lock', async () => {
    const secondConfig = {
      ddnsRecordId: '2041700000000000004',
      portForwardId: '2041700000000000003',
    };
    const first = subscription({ id: '100' });
    const second = subscription({
      activeKey: `${SOURCE_KEY}:${digestFor(secondConfig)}`,
      id: '101',
      sourceConfig: secondConfig,
      sourceConfigDigest: digestFor(secondConfig),
    });
    const rows = [first, second];
    const bothTargetsLocked = deferred();
    let targetLocks = 0;
    const repositories = ['100', '101'].map(
      () =>
        ({
          findOne: jest.fn(async (options) => {
            const where =
              options.where as FindOptionsWhere<QqbotMessageSubscription>;
            if (where.id) {
              if (options.lock?.mode === 'pessimistic_write') {
                targetLocks += 1;
                if (targetLocks === 2) bothTargetsLocked.resolve();
                await bothTargetsLocked.promise;
              }
              return rows.find((row) => row.id === where.id) ?? null;
            }
            if (options.lock?.mode === 'pessimistic_write') {
              throw { code: 'ER_LOCK_DEADLOCK', errno: 1213 };
            }
            return (
              rows.find((row) => row.activeKey === where.activeKey) ?? null
            );
          }),
          save: jest.fn(),
        }) as unknown as jest.Mocked<Repository<QqbotMessageSubscription>>,
    );
    const managers = repositories.map(
      (repository) =>
        ({
          getRepository: jest.fn((entity) => {
            if (entity === QqbotMessageSubscription) return repository;
            throw new Error('unexpected repository');
          }),
        }) as unknown as EntityManager,
    );
    const source = adapter();
    source.normalizeSubscriptionConfig.mockImplementation(async (input) => {
      const config = input as typeof CONFIG;
      const canonicalConfig =
        config.portForwardId === secondConfig.portForwardId
          ? secondConfig
          : CONFIG;
      return {
        canonicalConfig,
        resourceKey: canonicalConfig.portForwardId,
        sourceSummary: '交叉更新',
      };
    });
    const transaction = jest.fn((callback) => {
      const manager = managers.shift();
      if (!manager) throw new Error('unexpected transaction');
      return callback(manager);
    });
    const service = new QqbotMessageSubscriptionService(
      {
        manager: { transaction },
      } as unknown as Repository<QqbotMessageSubscription>,
      registry(source),
    );

    const [firstError, secondError] = await Promise.all([
      service
        .update('100', {
          enabled: true,
          name: '改为第二条配置',
          sourceConfig: secondConfig,
          sourceKey: SOURCE_KEY,
        })
        .catch((error: unknown) => error),
      service
        .update('101', {
          enabled: true,
          name: '改为第一条配置',
          sourceConfig: CONFIG,
          sourceKey: SOURCE_KEY,
        })
        .catch((error: unknown) => error),
    ]);

    expect(firstError).toMatchObject({ status: HttpStatus.CONFLICT });
    expect(secondError).toMatchObject({ status: HttpStatus.CONFLICT });
    for (const repository of repositories) {
      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
          where: expect.objectContaining({ id: expect.any(String) }),
        }),
      );
      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ activeKey: expect.any(String) }),
        }),
      );
      const prospectiveRead = repository.findOne.mock.calls.find(
        ([options]) =>
          (options.where as FindOptionsWhere<QqbotMessageSubscription>)
            .activeKey !== undefined,
      )?.[0];
      expect(prospectiveRead?.lock).toBeUndefined();
    }
  });

  describe('delivery cancellation transaction', () => {
    function cancellationHarness() {
      const subscriptions = [subscription()];
      const deliveries = [
        ...[
          'waiting_ddns',
          'pending',
          'retry',
          'processing',
          'success',
          'failed',
          'superseded',
          'cancelled',
        ].map((status, index) => ({
          frozen: `exact-${status}`,
          id: `delivery-${index}`,
          nextAttemptAt: `schedule-${status}`,
          processingLeaseUntil: `lease-${status}`,
          status,
          subscriptionId: '100',
        })),
        {
          frozen: 'other',
          id: 'delivery-other',
          nextAttemptAt: 'schedule-other',
          processingLeaseUntil: 'lease-other',
          status: 'pending',
          subscriptionId: '101',
        },
      ];
      let failCancellation = false;
      const deliveryUpdates: Array<Record<string, unknown>> = [];
      const transaction = jest.fn(
        async (work: (manager: EntityManager) => Promise<unknown>) => {
          const draftSubscriptions = subscriptions.map((row) => ({
            ...row,
            sourceConfig: { ...row.sourceConfig },
          })) as QqbotMessageSubscription[];
          const draftDeliveries = structuredClone(deliveries);
          const subscriptionStore = {
            findOne: jest.fn(
              async ({ where }: { where: Record<string, unknown> }) =>
                draftSubscriptions.find((row) =>
                  Object.entries(where).every(
                    ([key, value]) => row[key] === value,
                  ),
                ) ?? null,
            ),
            save: jest.fn(async (row: QqbotMessageSubscription) => row),
          };
          const manager = {
            getRepository: jest.fn((entity) => {
              if (entity === QqbotMessageSubscription) return subscriptionStore;
              if (entity === QqbotMessagePublishBinding) {
                return { count: jest.fn().mockResolvedValue(0) };
              }
              if (entity === QqbotMessageDelivery) {
                return {
                  update: jest.fn(
                    async (
                      where: Record<string, unknown>,
                      patch: Record<string, unknown>,
                    ) => {
                      deliveryUpdates.push(where);
                      const statuses = (where.status as { _value?: unknown[] })
                        ._value;
                      let affected = 0;
                      draftDeliveries.forEach((row) => {
                        if (
                          row.subscriptionId === where.subscriptionId &&
                          statuses?.includes(row.status)
                        ) {
                          Object.assign(row, patch);
                          affected += 1;
                        }
                      });
                      if (failCancellation) {
                        throw new Error('cancellation persistence failed');
                      }
                      return { affected };
                    },
                  ),
                };
              }
              throw new Error('unexpected cancellation repository');
            }),
          } as unknown as EntityManager;
          const result = await work(manager);
          subscriptions.splice(0, subscriptions.length, ...draftSubscriptions);
          deliveries.splice(0, deliveries.length, ...draftDeliveries);
          return result;
        },
      );
      const source = adapter();
      source.normalizeSubscriptionConfig.mockImplementation(async (input) => {
        const canonicalConfig = input as Record<string, string>;
        return {
          canonicalConfig,
          resourceKey: canonicalConfig.portForwardId,
          sourceSummary: 'transaction fixture',
        };
      });
      const service = new QqbotMessageSubscriptionService(
        {
          manager: { transaction },
        } as unknown as Repository<QqbotMessageSubscription>,
        registry(source),
      );
      return {
        deliveries,
        deliveryUpdates,
        failCancellation: () => {
          failCancellation = true;
        },
        service,
        subscriptions,
      };
    }

    it.each([
      [
        'disable',
        async (service: QqbotMessageSubscriptionService) =>
          service.setEnabled('100', false),
        false,
      ],
      [
        'soft delete',
        async (service: QqbotMessageSubscriptionService) =>
          service.remove('100'),
        false,
      ],
      [
        'canonical config change',
        async (service: QqbotMessageSubscriptionService) =>
          service.update('100', {
            enabled: true,
            name: '端口提醒',
            remark: null,
            sourceConfig: {
              ddnsRecordId: '2041700000000000099',
              portForwardId: CONFIG.portForwardId,
            },
            sourceKey: SOURCE_KEY,
          }),
        true,
      ],
    ])(
      '%s commits config and applies the exact identity-sensitive cancellation fence',
      async (_name, mutate, cancelsProcessing) => {
        const harness = cancellationHarness();
        const before = structuredClone(harness.deliveries);
        const cancellableStatuses = [
          'waiting_ddns',
          'pending',
          'retry',
          ...(cancelsProcessing ? ['processing'] : []),
        ];

        await mutate(harness.service);

        expect(harness.deliveries).toEqual(
          before.map((delivery) =>
            delivery.subscriptionId === '100' &&
            cancellableStatuses.includes(delivery.status)
              ? {
                  ...delivery,
                  nextAttemptAt: null,
                  processingLeaseUntil: null,
                  status: 'cancelled',
                }
              : delivery,
          ),
        );
        expect(
          (harness.deliveryUpdates[0].status as { _value: string[] })._value,
        ).toEqual(cancellableStatuses);
      },
    );

    it('does not cancel for name/remark-only edits or the same canonical identity', async () => {
      const harness = cancellationHarness();
      const before = structuredClone(harness.deliveries);

      await harness.service.update('100', {
        enabled: true,
        name: '新名称',
        remark: '新备注',
        sourceConfig: { ...CONFIG },
        sourceKey: SOURCE_KEY,
      });

      expect(harness.deliveries).toEqual(before);
      expect(harness.deliveryUpdates).toHaveLength(0);
    });

    it('rolls back both subscription mutation and draft cancellations when cancellation persistence fails', async () => {
      const harness = cancellationHarness();
      const subscriptionsBefore = harness.subscriptions.map((row) => ({
        ...row,
        sourceConfig: { ...row.sourceConfig },
      }));
      const deliveriesBefore = structuredClone(harness.deliveries);
      harness.failCancellation();

      await expect(harness.service.setEnabled('100', false)).rejects.toThrow(
        'cancellation persistence failed',
      );

      expect(harness.subscriptions).toEqual(subscriptionsBefore);
      expect(harness.deliveries).toEqual(deliveriesBefore);
    });
  });

  it('pages only undeleted records with real filters and returns detached, real-time source status', async () => {
    const source = adapter({
      invalidReasonCode: 'ddns_mapping_mismatch',
      sourceSummary: '已失效',
      valid: false,
    });
    const first = subscription();
    const { service, subscriptionRepository } = setup(
      [
        first,
        subscription({ id: '101', isDeleted: true }),
        subscription({ enabled: false, id: '102' }),
        subscription({ id: '103', name: '不匹配' }),
        subscription({ id: '104', sourceKey: 'other.source' }),
      ],
      source,
    );

    const page = await service.page({
      enabled: true,
      name: '端口',
      pageNo: 1,
      pageSize: 10,
      sourceKey: SOURCE_KEY,
    });
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          invalidReasonCode: 'ddns_mapping_mismatch',
          sourceName: 'STUN 端口变化',
          sourceSummary: '已失效',
          valid: false,
        }),
      ],
      total: 1,
    });
    page.items[0].sourceConfig.portForwardId = 'mutated';
    expect(first.sourceConfig.portForwardId).toBe(CONFIG.portForwardId);
    expect(subscriptionRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        where: {
          enabled: true,
          isDeleted: false,
          name: expect.objectContaining({ _type: 'like', _value: '%端口%' }),
          sourceKey: SOURCE_KEY,
        },
      }),
    );
  });

  it('keeps a structurally valid source valid without a current Keeper lease and rejects only enabling an invalid relationship', async () => {
    const leaseMissing = adapter({
      invalidReasonCode: null,
      sourceSummary: '映射关系合法，当前无租约',
      valid: true,
    });
    const valid = setup([subscription({ enabled: false })], leaseMissing);
    await expect(valid.service.page({})).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ valid: true })],
      }),
    );
    await expect(valid.service.setEnabled('100', true)).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );

    const invalid = adapter({
      invalidReasonCode: 'ddns_mapping_mismatch',
      sourceSummary: '失效',
      valid: false,
    });
    const blocked = setup([subscription({ enabled: false })], invalid);
    await expect(blocked.service.setEnabled('100', true)).rejects.toMatchObject(
      { code: 'ddns_mapping_mismatch' },
    );
    await expect(blocked.service.setEnabled('100', false)).resolves.toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('uses the real STUN adapter to keep a structurally valid subscription valid without a lease', async () => {
    const mapping = {
      desiredPresence: 'present',
      externalPort: 8213,
      id: CONFIG.portForwardId,
      internalPort: 8213,
      isDeleted: false,
      keeperDesiredEnabled: true,
      name: '帕鲁新世界',
      protocol: 'udp',
    } as NetworkPortForward;
    const record = {
      domain: 'example.com',
      enabled: true,
      id: CONFIG.ddnsRecordId,
      isDeleted: false,
      portForwardId: CONFIG.portForwardId,
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    } as NetworkDdnsRecord;
    const source = new NetworkStunMessageSourceAdapter(
      {
        findOne: jest.fn(async () => mapping),
      } as unknown as Repository<NetworkPortForward>,
      {
        findOne: jest.fn(async () => record),
      } as unknown as Repository<NetworkDdnsRecord>,
      new SystemMessageSourceRegistry(),
    );
    const { service } = setup([subscription()], source);

    await expect(service.page({})).resolves.toEqual({
      items: [
        expect.objectContaining({
          invalidReasonCode: null,
          sourceSummary: '帕鲁新世界 · pal.example.com',
          valid: true,
        }),
      ],
      total: 1,
    });
  });

  it('uses the caller transaction lock for binding availability and permits disabled bindings only for non-deleted subscriptions', async () => {
    const source = adapter({
      invalidReasonCode: 'ddns_mapping_mismatch',
      sourceSummary: '失效',
      valid: false,
    });
    const current = subscription();
    const { manager, service, subscriptionRepository } = setup(
      [current],
      source,
    );

    await expect(
      service.requireAvailableForBinding(manager, '100', false),
    ).resolves.toBe(current);
    await expect(
      service.requireAvailableForBinding(manager, '100', true),
    ).rejects.toMatchObject({ code: 'ddns_mapping_mismatch' });
    current.enabled = false;
    await expect(
      service.requireAvailableForBinding(manager, '100', true),
    ).rejects.toMatchObject({ code: 'subscription_disabled' });
    current.isDeleted = true;
    await expect(
      service.requireAvailableForBinding(manager, '100', false),
    ).rejects.toMatchObject({ code: 'invalid_source_config' });
    expect(manager.getRepository).toHaveBeenCalledWith(
      QqbotMessageSubscription,
    );
    expect(subscriptionRepository.findOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '100', isDeleted: false },
    });
  });

  it('rejects deletion and source changes while enabled or disabled live bindings reference the subscription', async () => {
    const other = adapter();
    Object.assign(other.definition, { sourceKey: 'other.source' });
    const { bindingRepository, service, subscriptionRepository } = setup(
      [subscription()],
      adapter(),
      [{ isDeleted: false, subscriptionId: '100' }],
      [other],
    );

    await expect(service.remove('100')).rejects.toMatchObject({
      code: 'invalid_source_config',
    });
    await expect(
      service.update('100', {
        enabled: false,
        name: '改源',
        sourceConfig: CONFIG,
        sourceKey: 'other.source',
      }),
    ).rejects.toMatchObject({ code: 'invalid_source_config' });
    await expect(
      service.update('100', {
        enabled: false,
        name: '同源编辑',
        sourceConfig: CONFIG,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(expect.objectContaining({ name: '同源编辑' }));

    expect(bindingRepository.count).toHaveBeenCalledWith({
      where: { isDeleted: false, subscriptionId: '100' },
    });
    expect(subscriptionRepository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true }),
    );
  });

  it('makes a binding transaction observe deletion after the shared subscription row lock commits', async () => {
    const current = subscription();
    const deleteHasLock = deferred();
    const allowDeleteCommit = deferred();
    let lockTail = Promise.resolve();

    const transactionManager = (() => {
      let releaseLock: (() => void) | undefined;
      const acquireLock = async (): Promise<void> => {
        const previous = lockTail;
        const next = deferred();
        lockTail = next.promise;
        await previous;
        releaseLock = next.resolve;
      };
      const repository = {
        findOne: jest.fn(async (options) => {
          if (options.lock?.mode === 'pessimistic_write') {
            await acquireLock();
            deleteHasLock.resolve();
          }
          return current.isDeleted ? null : current;
        }),
        save: jest.fn(async (item: QqbotMessageSubscription) => {
          if (item.isDeleted) await allowDeleteCommit.promise;
          return item;
        }),
      } as unknown as Repository<QqbotMessageSubscription>;
      const manager = {
        getRepository: jest.fn((entity) => {
          if (entity === QqbotMessageSubscription) return repository;
          if (entity === QqbotMessagePublishBinding) {
            return { count: jest.fn(async () => 0) };
          }
          if (entity === QqbotMessageDelivery) {
            return { update: jest.fn(async () => ({ affected: 0 })) };
          }
          throw new Error('unexpected repository');
        }),
      } as unknown as EntityManager;
      Object.assign(manager, {
        transaction: async <T>(
          callback: (currentManager: EntityManager) => Promise<T>,
        ) => {
          try {
            return await callback(manager);
          } finally {
            releaseLock?.();
          }
        },
      });
      return manager;
    })();
    const service = new QqbotMessageSubscriptionService(
      { manager: transactionManager } as Repository<QqbotMessageSubscription>,
      registry(adapter()),
    );

    const deletion = service.remove('100');
    await deleteHasLock.promise;
    const binding = transactionManager.transaction((manager) =>
      service.requireAvailableForBinding(manager, '100', false),
    );
    await Promise.resolve();
    allowDeleteCommit.resolve();

    await expect(deletion).resolves.toBe(true);
    await expect(binding).rejects.toMatchObject({
      code: 'invalid_source_config',
    });
    expect(current).toEqual(
      expect.objectContaining({
        activeKey: null,
        enabled: false,
        isDeleted: true,
      }),
    );
  });
});
