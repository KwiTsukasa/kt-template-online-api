import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import type { NetworkAgentMqttService } from '../../../src/modules/admin/platform-config/network-management/network-agent-mqtt.service';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkEndpointHistory } from '../../../src/modules/admin/platform-config/network-management/network-endpoint-history.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkManagementService } from '../../../src/modules/admin/platform-config/network-management/network-management.service';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.entity';
import { NetworkPortForwardGroupService } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.service';
import { NetworkTcpReleasePolicyService } from '../../../src/modules/admin/platform-config/network-management/network-tcp-release-policy.service';

type Harness = {
  bootstrapOrder: string[];
  bootstrapExecute: jest.Mock;
  groups: NetworkPortForwardGroup[];
  histories: NetworkEndpointHistory[];
  injectedMappingFindOne: jest.Mock;
  mappings: NetworkPortForward[];
  mqtt: jest.Mocked<Pick<NetworkAgentMqttService, 'requestDesiredPublish'>>;
  service: NetworkManagementService;
  state: NetworkAgentState;
  transactionalMappingFindOne: jest.Mock;
};

type ReleaseConfig = {
  beforeTransaction?: () => void;
  canaryPorts?: string;
  mode?: string;
};

function createHarness(
  initialMappings: NetworkPortForward[] = [],
  releaseConfig: ReleaseConfig = {},
): Harness {
  const mappings = initialMappings;
  const groups = Array.from(
    new Set(mappings.map((mapping) => mapping.groupId)),
  ).map((groupId) => {
    const channels = mappings.filter((mapping) => mapping.groupId === groupId);
    const protocols = new Set(channels.map((mapping) => mapping.protocol));
    const first = channels[0];
    return Object.assign(new NetworkPortForwardGroup(), {
      externalPort: first.externalPort,
      id: groupId,
      internalPort: first.internalPort,
      isDeleted: false,
      name: first.name,
      protocolMode:
        protocols.size === 2 ? 'tcp_udp' : protocols.has('tcp') ? 'tcp' : 'udp',
      remark: first.remark || null,
      targetIpv4: first.targetIpv4,
    });
  });
  const histories: NetworkEndpointHistory[] = [];
  const bootstrapOrder: string[] = [];
  const bootstrapExecute = jest.fn().mockImplementation(async () => {
    bootstrapOrder.push('insert-ignore');
    return { identifiers: [] };
  });
  const findMapping = async ({ where }: { where: Record<string, unknown> }) =>
    mappings.find((mapping) =>
      Object.entries(where).every(([key, value]) => mapping[key] === value),
    ) || null;
  const injectedMappingFindOne = jest.fn(findMapping);
  const transactionalMappingFindOne = jest.fn(findMapping);
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
    find: async ({ where }) =>
      mappings.filter((mapping) =>
        Object.entries(where).every(([key, value]) => mapping[key] === value),
      ),
    findOne: injectedMappingFindOne,
    save: async (value) => {
      const values = Array.isArray(value) ? value : [value];
      for (const mapping of values) {
        const index = mappings.findIndex((item) => item.id === mapping.id);
        if (index >= 0) mappings[index] = mapping;
        else mappings.push(mapping);
      }
      return value;
    },
  } as unknown as Repository<NetworkPortForward>;
  const transactionalMappingRepository = {
    ...mappingRepository,
    findOne: transactionalMappingFindOne,
  } as unknown as Repository<NetworkPortForward>;
  const groupRepository = {
    create: (input) =>
      Object.assign(new NetworkPortForwardGroup(), { id: '200' }, input),
    findOne: async ({ where }) =>
      groups.find((group) =>
        Object.entries(where).every(([key, value]) => group[key] === value),
      ) || null,
    save: async (value) => {
      const values = Array.isArray(value) ? value : [value];
      for (const group of values) {
        const index = groups.findIndex((item) => item.id === group.id);
        if (index >= 0) groups[index] = group;
        else groups.push(group);
      }
      return value;
    },
  } as unknown as Repository<NetworkPortForwardGroup>;
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
      if (entity === NetworkPortForward) return transactionalMappingRepository;
      if (entity === NetworkPortForwardGroup) return groupRepository;
      if (entity === NetworkAgentState) return stateRepository;
      if (entity === NetworkEndpointHistory) return historyRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (work) => {
      releaseConfig.beforeTransaction?.();
      return await work(manager);
    },
  } as unknown as DataSource;
  const configService = {
    get: (key) =>
      ({
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_AGENT_TARGET_IPV4: '192.168.31.224',
        NETWORK_TCP_NATMAP_CANARY_PORTS: releaseConfig.canaryPorts,
        NETWORK_TCP_NATMAP_RELEASE_MODE: releaseConfig.mode,
      })[key],
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
    new NetworkTcpReleasePolicyService(configService),
    new NetworkPortForwardGroupService(
      groupRepository,
      mappingRepository,
      historyRepository,
      dataSource,
      configService,
      mqtt as unknown as NetworkAgentMqttService,
      new NetworkTcpReleasePolicyService(configService),
    ),
  );
  return {
    bootstrapExecute,
    bootstrapOrder,
    groups,
    histories,
    injectedMappingFindOne,
    mappings,
    mqtt,
    service,
    state,
    transactionalMappingFindOne,
  };
}

function createMapping(
  patch: Partial<NetworkPortForward> = {},
): NetworkPortForward {
  return Object.assign(new NetworkPortForward(), {
    activeKey: 'udp:9000',
    activeGroupProtocolKey: '200:udp',
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidUntil: null,
    desiredIssuedAt: new KtDateTime('2026-07-22T00:00:00.000Z'),
    desiredPresence: 'present',
    desiredRevision: '3',
    externalPort: 9000,
    groupId: '200',
    id: '100',
    internalPort: 9000,
    isDeleted: false,
    keeperDesiredEnabled: false,
    keeperStatus: 'disabled',
    name: 'rule',
    natmapDesiredEnabled: false,
    natmapStatus: 'disabled',
    protocol: 'udp',
    reportedRevision: '0',
    syncStatus: 'synced',
    targetIpv4: '192.168.31.224',
    ...patch,
  });
}

function createListBuilder(mappings: NetworkPortForward[]) {
  let rows = mappings.filter((mapping) => !mapping.isDeleted);
  let offset = 0;
  let limit = rows.length;
  const builder = {
    andWhere: (clause: string, values: Record<string, unknown>) => {
      if (clause.includes('mapping.protocol <>')) {
        rows = rows.filter(
          (mapping) => mapping.protocol !== values.hiddenProtocol,
        );
      } else if (clause.includes('mapping.protocol =')) {
        rows = rows.filter((mapping) => mapping.protocol === values.protocol);
      } else if (clause.includes('mapping.syncStatus =')) {
        rows = rows.filter(
          (mapping) => mapping.syncStatus === values.syncStatus,
        );
      } else if (clause.includes('mapping.name LIKE')) {
        const name = String(values.name).replaceAll('%', '');
        rows = rows.filter((mapping) => mapping.name.includes(name));
      }
      return builder;
    },
    getManyAndCount: async () => [
      rows.slice(offset, offset + limit),
      rows.length,
    ],
    orderBy: () => builder,
    skip: (value: number) => {
      offset = value;
      return builder;
    },
    take: (value: number) => {
      limit = value;
      return builder;
    },
    where: () => builder,
  };
  return builder;
}

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
      activeGroupProtocolKey: expect.any(String),
      activeKey: 'udp:9000',
      desiredRevision: '1',
      groupId: expect.any(String),
    });
    expect(harness.mappings[0].desiredIssuedAt.toISOString()).toBe(
      harness.state.desiredIssuedAt.toISOString(),
    );
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);
    expect(harness.bootstrapExecute).toHaveBeenCalledTimes(1);
  });

  it('keeps v1 channel-ID update and delete from mutating a multi-channel group', async () => {
    const udp = createMapping({
      activeGroupProtocolKey: '200:udp',
      groupId: '200',
    });
    const tcp = createMapping({
      activeGroupProtocolKey: '200:tcp',
      activeKey: 'tcp:9000',
      groupId: '200',
      id: '101',
      protocol: 'tcp',
    });
    const harness = createHarness([udp, tcp], { mode: 'on' });

    await expect(
      harness.service.update('100', { remark: 'legacy update' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(harness.service.remove('100')).rejects.toMatchObject({
      status: 409,
    });
    expect(harness.state.desiredRevision).toBe('3');
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

  it('hides TCP mappings outside on mode while keeping the ordinary list shape and count', async () => {
    const udpMapping = createMapping({ id: '100' });
    const tcpMapping = createMapping({
      activeKey: 'tcp:48213',
      externalPort: 48213,
      id: '101',
      internalPort: 48213,
      protocol: 'tcp',
    });
    const hidden = createHarness([udpMapping, tcpMapping]);
    const visible = createHarness([udpMapping, tcpMapping], { mode: 'on' });

    await expect(hidden.service.list()).resolves.toMatchObject({
      items: [{ id: '100', protocol: 'udp' }],
      total: 1,
    });
    await expect(visible.service.list()).resolves.toMatchObject({
      items: [{ id: '100' }, { id: '101' }],
      total: 2,
    });
  });

  it('gates TCP create by release mode and canary allowlist before persistence', async () => {
    const off = createHarness();
    await expect(
      off.service.create({
        externalPort: 48213,
        internalPort: 48213,
        name: 'tcp-off',
        protocol: 'tcp',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(off.state.desiredRevision).toBe('0');
    expect(off.mappings).toHaveLength(0);

    const rejectedCanary = createHarness([], {
      canaryPorts: '48214',
      mode: 'canary',
    });
    await expect(
      rejectedCanary.service.create({
        externalPort: 48213,
        internalPort: 48213,
        name: 'tcp-canary-rejected',
        protocol: 'tcp',
      }),
    ).rejects.toMatchObject({ status: 409 });

    const acceptedCanary = createHarness([], {
      canaryPorts: '48213',
      mode: 'canary',
    });
    await expect(
      acceptedCanary.service.create({
        externalPort: 48213,
        internalPort: 48213,
        name: 'tcp-canary',
        protocol: 'tcp',
      }),
    ).resolves.toMatchObject({ protocol: 'tcp' });
  });

  it('rejects TCP update and retry in off mode while permitting explicit TCP deletion cleanup', async () => {
    const mapping = createMapping({
      activeKey: 'tcp:48213',
      externalPort: 48213,
      internalPort: 48213,
      protocol: 'tcp',
    });
    const harness = createHarness([mapping], { mode: 'off' });

    await expect(
      harness.service.update('100', { externalPort: 48214 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(harness.service.retry('100')).rejects.toMatchObject({
      status: 409,
    });
    expect(harness.state.desiredRevision).toBe('3');
    await expect(harness.service.remove('100')).resolves.toMatchObject({
      desiredPresence: 'absent',
      protocol: 'tcp',
    });
  });

  it('allows canary TCP writes only on listed ports while cleanup survives allowlist removal', async () => {
    const allowedMapping = createMapping({
      activeKey: 'tcp:48213',
      externalPort: 48213,
      internalPort: 48213,
      protocol: 'tcp',
    });
    const allowed = createHarness([allowedMapping], {
      canaryPorts: '48213',
      mode: 'canary',
    });
    await expect(
      allowed.service.update('100', { remark: 'canary' }),
    ).resolves.toMatchObject({ remark: 'canary' });
    await expect(allowed.service.retry('100')).resolves.toMatchObject({
      protocol: 'tcp',
    });

    const removedMapping = createMapping({
      activeKey: 'tcp:48213',
      externalPort: 48213,
      internalPort: 48213,
      protocol: 'tcp',
    });
    const removed = createHarness([removedMapping], {
      canaryPorts: '48214',
      mode: 'canary',
    });
    await expect(removed.service.retry('100')).rejects.toMatchObject({
      status: 409,
    });
    await expect(removed.service.remove('100')).resolves.toMatchObject({
      desiredPresence: 'absent',
    });
  });

  it('keeps UDP update, retry, delete, Keeper, and probe paths unchanged while release is off', async () => {
    const mapping = createMapping();
    const harness = createHarness([mapping], { mode: 'off' });

    await expect(
      harness.service.update('100', { remark: 'udp' }),
    ).resolves.toMatchObject({ remark: 'udp' });
    await expect(harness.service.retry('100')).resolves.toMatchObject({
      protocol: 'udp',
    });
    mapping.syncStatus = 'synced';
    await expect(harness.service.enableKeeper('100')).resolves.toMatchObject({
      keeperDesiredEnabled: true,
    });
    mapping.syncStatus = 'synced';
    await expect(harness.service.probe('100')).resolves.toMatchObject({
      keeperDesiredEnabled: true,
    });
    mapping.syncStatus = 'synced';
    await expect(harness.service.disableKeeper('100')).resolves.toMatchObject({
      keeperDesiredEnabled: false,
    });
    mapping.syncStatus = 'synced';
    await expect(harness.service.remove('100')).resolves.toMatchObject({
      desiredPresence: 'absent',
    });
  });

  it('keeps repeated v1 Keeper switches idempotent while preserving channel-ID semantics', async () => {
    const mapping = createMapping();
    const harness = createHarness([mapping], { mode: 'off' });

    await harness.service.enableKeeper('100');
    const enabledRevision = harness.state.desiredRevision;
    const enabledChannelRevision = mapping.desiredRevision;
    const probeRequestId = mapping.probeRequestId;
    await harness.service.enableKeeper('100');
    expect(mapping.probeRequestId).toBe(probeRequestId);
    expect(mapping.desiredRevision).toBe(enabledChannelRevision);
    expect(harness.state.desiredRevision).toBe(enabledRevision);
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);

    mapping.syncStatus = 'synced';
    await harness.service.disableKeeper('100');
    const disabledRevision = harness.state.desiredRevision;
    const disabledChannelRevision = mapping.desiredRevision;
    await harness.service.disableKeeper('100');
    expect(mapping.desiredRevision).toBe(disabledChannelRevision);
    expect(harness.state.desiredRevision).toBe(disabledRevision);
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(2);

    await expect(harness.service.enableKeeper('200')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('locks the exact v1 channel ID in-transaction and never mutates its replacement', async () => {
    const stale = createMapping({ id: '100' });
    const replacement = createMapping({ id: '102', probeRequestId: null });
    const mappings = [stale];
    const harness = createHarness(mappings, {
      beforeTransaction: () => {
        stale.activeGroupProtocolKey = null;
        stale.activeKey = null;
        stale.isDeleted = true;
        mappings.push(replacement);
      },
      mode: 'off',
    });

    await expect(harness.service.enableKeeper('100')).rejects.toMatchObject({
      status: 404,
    });
    expect(harness.transactionalMappingFindOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '100', isDeleted: false },
    });
    expect(harness.injectedMappingFindOne).not.toHaveBeenCalled();
    expect(replacement).toMatchObject({
      desiredRevision: '3',
      keeperDesiredEnabled: false,
      probeRequestId: null,
    });
    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });
});
