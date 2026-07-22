import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import type { NetworkAgentMqttService } from '../../../src/modules/admin/platform-config/network-management/network-agent-mqtt.service';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkEndpointHistory } from '../../../src/modules/admin/platform-config/network-management/network-endpoint-history.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkManagementService } from '../../../src/modules/admin/platform-config/network-management/network-management.service';

type Harness = {
  bootstrapOrder: string[];
  bootstrapExecute: jest.Mock;
  histories: NetworkEndpointHistory[];
  mappings: NetworkPortForward[];
  mqtt: jest.Mocked<Pick<NetworkAgentMqttService, 'requestDesiredPublish'>>;
  service: NetworkManagementService;
  state: NetworkAgentState;
};

/**
 * Creates an in-memory TypeORM-shaped transaction harness for desired-state tests.
 * @param initialMappings - Existing active mappings copied into the fake repository.
 * @returns Mutable persistence state and real application service.
 */
function createHarness(initialMappings: NetworkPortForward[] = []): Harness {
  const mappings = initialMappings;
  const histories: NetworkEndpointHistory[] = [];
  const bootstrapOrder: string[] = [];
  const bootstrapExecute = jest.fn().mockImplementation(async () => {
    bootstrapOrder.push('insert-ignore');
    return { identifiers: [] };
  });
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '0',
    desiredIssuedAt: new KtDateTime('2026-07-22T00:00:00.000Z'),
    desiredRevision: initialMappings.length ? '3' : '0',
    online: false,
    publishedRevision: '0',
    targetIpv4: '192.168.31.224',
  });
  const mappingRepository = {
    count: async () => mappings.filter((mapping) => !mapping.isDeleted).length,
    create: (input) =>
      Object.assign(new NetworkPortForward(), { id: '100' }, input),
    createQueryBuilder: () => createListBuilder(mappings),
    findOne: async ({ where }) =>
      mappings.find((mapping) =>
        Object.entries(where).every(([key, value]) => mapping[key] === value),
      ) || null,
    save: async (mapping) => {
      const index = mappings.findIndex((item) => item.id === mapping.id);
      if (index >= 0) mappings[index] = mapping;
      else mappings.push(mapping);
      return mapping;
    },
  } as unknown as Repository<NetworkPortForward>;
  const stateRepository = {
    create: (input) => Object.assign(new NetworkAgentState(), input),
    createQueryBuilder: () => {
      const builder = {
        execute: bootstrapExecute,
        insert: () => builder,
        into: () => builder,
        orIgnore: () => builder,
        values: () => builder,
      };
      return builder;
    },
    findOne: async () => {
      bootstrapOrder.push('pessimistic-lock');
      return state;
    },
    save: async (value) => Object.assign(state, value),
  } as unknown as Repository<NetworkAgentState>;
  const historyRepository = {
    findAndCount: jest.fn(async () => [histories, histories.length]),
  } as unknown as Repository<NetworkEndpointHistory>;
  const manager = {
    getRepository: (entity) => {
      if (entity === NetworkPortForward) return mappingRepository;
      if (entity === NetworkAgentState) return stateRepository;
      if (entity === NetworkEndpointHistory) return historyRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (work) => await work(manager),
  } as unknown as DataSource;
  const configService = {
    get: (key) =>
      key === 'NETWORK_AGENT_TARGET_IPV4'
        ? '192.168.31.224'
        : key === 'NETWORK_AGENT_ID'
          ? 'nas-main'
          : undefined,
  } as ConfigService;
  const mqtt = {
    requestDesiredPublish: jest.fn(),
  } as jest.Mocked<Pick<NetworkAgentMqttService, 'requestDesiredPublish'>>;
  const service = new NetworkManagementService(
    mappingRepository,
    historyRepository,
    stateRepository,
    dataSource,
    configService,
    mqtt as unknown as NetworkAgentMqttService,
  );
  return {
    bootstrapExecute,
    bootstrapOrder,
    histories,
    mappings,
    mqtt,
    service,
    state,
  };
}

/**
 * Creates a complete persisted mapping fixture.
 * @param patch - Desired field overrides.
 * @returns Active mapping entity suitable for mutation tests.
 */
function createMapping(
  patch: Partial<NetworkPortForward> = {},
): NetworkPortForward {
  return Object.assign(new NetworkPortForward(), {
    activeKey: 'udp:9000',
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidUntil: null,
    desiredIssuedAt: new KtDateTime('2026-07-22T00:00:00.000Z'),
    desiredPresence: 'present',
    desiredRevision: '3',
    externalPort: 9000,
    id: '100',
    internalPort: 9000,
    isDeleted: false,
    keeperDesiredEnabled: false,
    keeperStatus: 'disabled',
    name: 'rule',
    protocol: 'udp',
    reportedRevision: '0',
    syncStatus: 'synced',
    targetIpv4: '192.168.31.224',
    ...patch,
  });
}

/**
 * Creates the fluent query builder subset used by the service list method.
 * @param mappings - Current in-memory rows.
 * @returns Chainable fake returning all rows.
 */
function createListBuilder(mappings: NetworkPortForward[]) {
  const builder = {
    andWhere: () => builder,
    getManyAndCount: async () => [mappings, mappings.length],
    orderBy: () => builder,
    skip: () => builder,
    take: () => builder,
    where: () => builder,
  };
  return builder;
}

/** Extracts the Nest status from a rejected desired-state operation. */
function errorStatus(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 0;
}

describe('NetworkManagementService', () => {
  it('creates one desired mapping and advances the locked global revision once', async () => {
    const harness = createHarness();

    await expect(
      harness.service.create({
        externalPort: 9000,
        internalPort: 9000,
        name: ' Game Server ',
        protocol: 'udp',
      }),
    ).resolves.toMatchObject({
      desiredRevision: '1',
      id: '100',
      name: 'Game Server',
      syncStatus: 'pending',
      targetIpv4: '192.168.31.224',
    });
    expect(harness.state.desiredRevision).toBe('1');
    expect(harness.mappings[0]).toMatchObject({
      activeKey: 'udp:9000',
      desiredRevision: '1',
    });
    expect(harness.mappings[0].desiredIssuedAt.toISOString()).toBe(
      harness.state.desiredIssuedAt.toISOString(),
    );
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);
    expect(harness.bootstrapExecute).toHaveBeenCalledTimes(1);
  });

  it('uses insert-ignore bootstrap before the singleton pessimistic lock', async () => {
    const harness = createHarness();

    await harness.service.create({
      externalPort: 9000,
      internalPort: 9000,
      name: 'bootstrap-safe',
      protocol: 'udp',
    });

    expect(harness.bootstrapExecute).toHaveBeenCalledTimes(1);
    expect(harness.bootstrapOrder).toEqual([
      'insert-ignore',
      'pessimistic-lock',
    ]);
    expect(harness.state.desiredRevision).toBe('1');
  });

  it('rejects duplicate active keys without advancing revision', async () => {
    const harness = createHarness([createMapping()]);

    await harness.service
      .create({
        externalPort: 9000,
        internalPort: 9999,
        name: 'duplicate',
        protocol: 'udp',
      })
      .catch((error) => expect(errorStatus(error)).toBe(409));

    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });

  it('rejects names that exceed the Agent UTF-8 byte boundary', async () => {
    const harness = createHarness();

    await harness.service
      .create({
        externalPort: 9000,
        internalPort: 9000,
        name: '网'.repeat(43),
        protocol: 'udp',
      })
      .catch((error) => expect(errorStatus(error)).toBe(400));

    expect(harness.state.desiredRevision).toBe('0');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });

  it('rejects a sixty-fifth mapping before publishing an invalid snapshot', async () => {
    const existing = Array.from({ length: 64 }, (_, index) =>
      createMapping({
        activeKey: `udp:${9000 + index}`,
        externalPort: 9000 + index,
        id: `${100 + index}`,
        internalPort: 9000 + index,
      }),
    );
    const harness = createHarness(existing);

    await harness.service
      .create({
        externalPort: 9100,
        internalPort: 9100,
        name: 'too-many',
        protocol: 'udp',
      })
      .catch((error) => expect(errorStatus(error)).toBe(409));

    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });

  it('keeps the active key through a deletion tombstone', async () => {
    const mapping = createMapping({
      currentPublicIpv4: '203.0.113.10',
      currentPublicPort: 45000,
      currentValidUntil: new KtDateTime('2099-07-22T00:00:00.000Z'),
      keeperDesiredEnabled: true,
    });
    const harness = createHarness([mapping]);

    await expect(harness.service.remove('100')).resolves.toMatchObject({
      currentPublicEndpoint: null,
      desiredPresence: 'absent',
      desiredRevision: '4',
      syncStatus: 'deleting',
    });
    expect(mapping.activeKey).toBe('udp:9000');
    expect(mapping.isDeleted).toBe(false);
    expect(mapping.currentPublicIpv4).toBeNull();
  });

  it('clears an existing remark when update explicitly supplies an empty string', async () => {
    const mapping = createMapping({ remark: 'managed' });
    const harness = createHarness([mapping]);

    await expect(
      harness.service.update('100', { remark: '' }),
    ).resolves.toMatchObject({
      remark: null,
    });
    expect(mapping.remark).toBeNull();
  });

  it('rejects Keeper actions for TCP without changing desired revision', async () => {
    const mapping = createMapping({
      activeKey: 'tcp:9000',
      protocol: 'tcp',
    });
    const harness = createHarness([mapping]);

    await harness.service
      .enableKeeper('100')
      .catch((error) => expect(errorStatus(error)).toBe(400));

    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });

  it('hides an expired current endpoint while retaining last observation', async () => {
    const mapping = createMapping({
      currentObservedAt: new KtDateTime('2026-07-22T00:00:00.000Z'),
      currentPublicIpv4: '203.0.113.10',
      currentPublicPort: 45000,
      currentValidUntil: new KtDateTime('2026-07-22T00:01:00.000Z'),
      lastObservedAt: new KtDateTime('2026-07-22T00:00:00.000Z'),
      lastObservedIpv4: '203.0.113.10',
      lastObservedPort: 45000,
    });
    const harness = createHarness([mapping]);

    await expect(harness.service.list()).resolves.toMatchObject({
      items: [
        {
          currentPublicEndpoint: null,
          currentPublicIpv4: null,
          lastObservedIpv4: '203.0.113.10',
          lastObservedPort: 45000,
        },
      ],
      total: 1,
    });
  });

  it('serializes endpoint history and unified Agent error fields for Admin', async () => {
    const harness = createHarness([createMapping()]);
    harness.histories.push(
      Object.assign(new NetworkEndpointHistory(), {
        createTime: new KtDateTime('2026-07-22T01:02:06.000Z'),
        eventId: 'event-1',
        eventType: 'withdrawn',
        firstObservedAt: new KtDateTime('2026-07-22T01:02:04.000Z'),
        id: '300',
        lastObservedAt: new KtDateTime('2026-07-22T01:02:04.000Z'),
        mappingId: '100',
        occurredAt: new KtDateTime('2026-07-22T01:02:05.000Z'),
        publicIpv4: '8.8.8.8',
        publicPort: 45000,
        reason: 'keeper_disabled',
      }),
    );
    harness.state.lastMqttErrorCode = 'mqtt_fallback';
    harness.state.lastMqttErrorMessage = 'mqtt fallback';
    harness.state.lastReconcileErrorCode = 'router_conflict';
    harness.state.lastReconcileErrorMessage = 'router conflict';

    await expect(harness.service.endpointHistory('100')).resolves.toMatchObject(
      {
        items: [
          {
            eventId: 'event-1',
            id: '300',
            portForwardId: '100',
            withdrawalReason: 'keeper_disabled',
          },
        ],
        total: 1,
      },
    );
    await expect(harness.service.agentStatus()).resolves.toMatchObject({
      lastErrorCode: 'router_conflict',
      lastErrorMessage: 'router conflict',
      lastMqttErrorCode: 'mqtt_fallback',
      lastReconcileErrorCode: 'router_conflict',
    });
  });
});
