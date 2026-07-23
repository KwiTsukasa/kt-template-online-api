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
import { NetworkStunMessageSourceAdapter } from '../../../../src/modules/admin/platform-config/network-management/network-stun-message-source.adapter';
import { NetworkDdnsRecord } from '../../../../src/modules/admin/platform-config/network-management/network-ddns.entity';
import { NetworkPortForward } from '../../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const NOW = new KtDateTime('2026-07-24 08:09:10');
const CONFIG = {
  ddnsRecordId: '2041700000000000002',
  portForwardId: '2041700000000000001',
};

/** Creates a subscription fixture with deterministic string IDs and project timestamps. */
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

/** Calculates the exact stable digest that production natural-key persistence requires. */
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

/** Reads TypeORM Like's internal test value for high-fidelity in-memory filtering. */
function likeValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { _value?: unknown };
  return typeof candidate._value === 'string' ? candidate._value : undefined;
}

/** Builds a promise gate whose release is controlled by a concurrency test. */
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

/** Builds a controllable adapter whose current validity can change after persistence. */
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
      subscriptionFields: [],
      variables: [],
      version: 1,
    },
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
    validateEventPayload: jest.fn(),
  };
}

/** Registers one test source adapter in a fresh process-local source registry. */
function registry(
  source: SystemMessageSourceAdapter,
): SystemMessageSourceRegistry {
  const value = new SystemMessageSourceRegistry();
  value.register(source);
  return value;
}

/** Builds a transaction-aware repository fake backed by mutable subscription rows. */
function setup(
  items: QqbotMessageSubscription[] = [],
  source: SystemMessageSourceAdapter = adapter(),
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
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessageSubscription) return subscriptionRepository;
      throw new Error('unexpected repository');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  Object.assign(subscriptionRepository, {
    manager: { transaction: jest.fn((callback) => callback(manager)) },
  });
  const service = new QqbotMessageSubscriptionService(
    subscriptionRepository,
    registry(source),
  );
  return { items, manager, service, source, subscriptionRepository };
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
        sourceConfig: { ...CONFIG, ignored: 'discarded' },
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
      ignored: 'discarded',
    });
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

  it('makes a binding transaction observe deletion after the shared subscription row lock commits', async () => {
    const current = subscription();
    const deleteHasLock = deferred();
    const allowDeleteCommit = deferred();
    let lockTail = Promise.resolve();

    /** Creates a manager whose pessimistic row lock lasts until its transaction callback settles. */
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
