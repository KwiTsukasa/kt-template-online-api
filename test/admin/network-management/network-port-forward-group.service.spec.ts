import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import type { NetworkAgentMqttService } from '../../../src/modules/admin/platform-config/network-management/infrastructure/integration/network-agent-mqtt.service';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkEndpointHistory } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-endpoint-history.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkPortForwardGroupService } from '../../../src/modules/admin/platform-config/network-management/application/network-port-forward-group.service';
import { NetworkTcpReleasePolicyService } from '../../../src/modules/admin/platform-config/network-management/application/network-tcp-release-policy.service';

type Harness = {
  groups: NetworkPortForwardGroup[];
  histories: NetworkEndpointHistory[];
  mappings: NetworkPortForward[];
  mqtt: jest.Mocked<Pick<NetworkAgentMqttService, 'requestDesiredPublish'>>;
  service: NetworkPortForwardGroupService;
  state: NetworkAgentState;
};

function createHarness(
  initialGroups: NetworkPortForwardGroup[] = [],
  initialMappings: NetworkPortForward[] = [],
): Harness {
  const groups = initialGroups;
  const mappings = initialMappings;
  const histories: NetworkEndpointHistory[] = [];
  let nextGroupId = 200;
  let nextMappingId = 100;
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '0',
    desiredIssuedAt: new KtDateTime('2026-07-26T00:00:00.000Z'),
    desiredRevision: initialMappings.length ? '3' : '0',
    online: false,
    publishedRevision: '0',
    targetIpv4: '192.168.31.224',
  });
  const groupRepository = {
    count: async () => groups.filter((group) => !group.isDeleted).length,
    create: (input) => Object.assign(new NetworkPortForwardGroup(), input),
    createQueryBuilder: () => createGroupListBuilder(groups),
    findOne: async ({ where }) => findOne(groups, where),
    save: async (value) => {
      const values = Array.isArray(value) ? value : [value];
      for (const group of values) {
        if (!group.id) group.id = String(nextGroupId++);
        const index = groups.findIndex((item) => item.id === group.id);
        if (index >= 0) groups[index] = group;
        else groups.push(group);
      }
      return value;
    },
  } as unknown as Repository<NetworkPortForwardGroup>;
  const mappingRepository = {
    count: async () => mappings.filter((mapping) => !mapping.isDeleted).length,
    create: (input) => Object.assign(new NetworkPortForward(), input),
    find: async ({ where }) =>
      mappings.filter((mapping) => matches(mapping, where)),
    findOne: async ({ where }) => findOne(mappings, where),
    save: async (value) => {
      const values = Array.isArray(value) ? value : [value];
      for (const mapping of values) {
        if (!mapping.id) mapping.id = String(nextMappingId++);
        const duplicate = mappings.find(
          (item) =>
            item.id !== mapping.id &&
            ((mapping.activeKey && item.activeKey === mapping.activeKey) ||
              (mapping.activeGroupProtocolKey &&
                item.activeGroupProtocolKey ===
                  mapping.activeGroupProtocolKey)),
        );
        if (duplicate) {
          const error = new Error('duplicate') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        const index = mappings.findIndex((item) => item.id === mapping.id);
        if (index >= 0) mappings[index] = mapping;
        else mappings.push(mapping);
      }
      return value;
    },
  } as unknown as Repository<NetworkPortForward>;
  const historyRepository = {
    findAndCount: jest.fn(async ({ where }) => {
      const rows = histories.filter((history) => matches(history, where));
      return [rows, rows.length];
    }),
  } as unknown as Repository<NetworkEndpointHistory>;
  const stateRepository = {
    createQueryBuilder: () => {
      const builder = {
        execute: async () => ({ identifiers: [] }),
        insert: () => builder,
        into: () => builder,
        orIgnore: () => builder,
        values: () => builder,
      };
      return builder;
    },
    findOne: async () => state,
    save: async (value) => Object.assign(state, value),
  } as unknown as Repository<NetworkAgentState>;
  const manager = {
    getRepository: (entity) => {
      if (entity === NetworkPortForwardGroup) return groupRepository;
      if (entity === NetworkPortForward) return mappingRepository;
      if (entity === NetworkEndpointHistory) return historyRepository;
      if (entity === NetworkAgentState) return stateRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (work) => {
      const groupSnapshot = groups.map((group) => ({ ...group }));
      const mappingSnapshot = mappings.map((mapping) => ({ ...mapping }));
      const stateSnapshot = { ...state };
      try {
        return await work(manager);
      } catch (error) {
        groups.splice(
          0,
          groups.length,
          ...groupSnapshot.map((group) =>
            Object.assign(new NetworkPortForwardGroup(), group),
          ),
        );
        mappings.splice(
          0,
          mappings.length,
          ...mappingSnapshot.map((mapping) =>
            Object.assign(new NetworkPortForward(), mapping),
          ),
        );
        Object.assign(state, stateSnapshot);
        throw error;
      }
    },
  } as unknown as DataSource;
  const configService = {
    get: (key) =>
      ({
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_AGENT_TARGET_IPV4: '192.168.31.224',
        NETWORK_TCP_NATMAP_RELEASE_MODE: 'on',
      })[key],
  } as ConfigService;
  const mqtt = {
    requestDesiredPublish: jest.fn(),
  } as jest.Mocked<Pick<NetworkAgentMqttService, 'requestDesiredPublish'>>;
  const service = new NetworkPortForwardGroupService(
    groupRepository,
    mappingRepository,
    historyRepository,
    dataSource,
    configService,
    mqtt as unknown as NetworkAgentMqttService,
    new NetworkTcpReleasePolicyService(configService),
  );
  return { groups, histories, mappings, mqtt, service, state };
}

function createGroup(
  patch: Partial<NetworkPortForwardGroup> = {},
): NetworkPortForwardGroup {
  return Object.assign(new NetworkPortForwardGroup(), {
    externalPort: 9000,
    id: '200',
    internalPort: 9000,
    isDeleted: false,
    name: 'group',
    protocolMode: 'tcp_udp',
    remark: null,
    targetIpv4: '192.168.31.224',
    ...patch,
  });
}

function createMapping(
  patch: Partial<NetworkPortForward> = {},
): NetworkPortForward {
  const protocol = patch.protocol || 'udp';
  const id = patch.id || (protocol === 'tcp' ? '101' : '100');
  return Object.assign(new NetworkPortForward(), {
    activeGroupProtocolKey: `200:${protocol}`,
    activeKey: `${protocol}:9000`,
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidUntil: null,
    desiredIssuedAt: new KtDateTime('2026-07-26T00:00:00.000Z'),
    desiredPresence: 'present',
    desiredRevision: '3',
    externalPort: 9000,
    groupId: '200',
    id,
    internalPort: 9000,
    isDeleted: false,
    keeperDesiredEnabled: false,
    keeperStatus: 'disabled',
    name: 'group',
    natmapDesiredEnabled: false,
    natmapStatus: 'disabled',
    probeRequestId: null,
    protocol,
    remark: null,
    reportedRevision: '3',
    syncStatus: 'synced',
    targetIpv4: '192.168.31.224',
    ...patch,
  });
}

function matches(value: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(
    ([key, expected]) => value[key] === expected,
  );
}

function findOne<T extends object>(
  values: T[],
  where: Record<string, unknown>,
): T | null {
  return values.find((value) => matches(value, where)) || null;
}

function createGroupListBuilder(groups: NetworkPortForwardGroup[]) {
  let rows = groups.filter((group) => !group.isDeleted);
  let offset = 0;
  let limit = rows.length;
  const builder = {
    andWhere: (clause: string, values: Record<string, unknown>) => {
      if (clause.includes('group.name LIKE')) {
        const name = String(values.name).replaceAll('%', '');
        rows = rows.filter((group) => group.name.includes(name));
      } else if (clause.includes('group.protocolMode =')) {
        rows = rows.filter(
          (group) => group.protocolMode === values.protocolMode,
        );
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

describe('NetworkPortForwardGroupService', () => {
  it('creates tcp_udp atomically with one group authority and one global revision', async () => {
    const harness = createHarness();

    await expect(
      harness.service.create({
        externalPort: 9000,
        internalPort: 9000,
        name: ' Dual Rule ',
        protocolMode: 'tcp_udp',
        remark: 'both',
      }),
    ).resolves.toMatchObject({
      appliedProtocolMode: null,
      channels: {
        tcp: { desiredRevision: '1', id: expect.any(String) },
        udp: { desiredRevision: '1', id: expect.any(String) },
      },
      id: expect.any(String),
      name: 'Dual Rule',
      protocolMode: 'tcp_udp',
    });
    expect(harness.groups).toHaveLength(1);
    expect(harness.mappings).toHaveLength(2);
    expect(harness.state.desiredRevision).toBe('1');
    expect(harness.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeGroupProtocolKey: '200:tcp',
          activeKey: 'tcp:9000',
          groupId: '200',
          name: 'Dual Rule',
        }),
        expect.objectContaining({
          activeGroupProtocolKey: '200:udp',
          activeKey: 'udp:9000',
          groupId: '200',
          name: 'Dual Rule',
        }),
      ]),
    );
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);
  });

  it('projects group authority while preserving channel-specific revisions and derives appliedProtocolMode', async () => {
    const group = createGroup();
    const tcp = createMapping({ protocol: 'tcp' });
    const udp = createMapping({ protocol: 'udp' });
    const harness = createHarness([group], [tcp, udp]);

    await expect(harness.service.list()).resolves.toMatchObject({
      items: [{ appliedProtocolMode: 'tcp_udp' }],
    });
    await harness.service.enableNatmap('200');
    expect(tcp.desiredRevision).toBe('4');
    expect(udp.desiredRevision).toBe('3');
    await harness.service.enableNatmap('200');
    expect(harness.state.desiredRevision).toBe('4');
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);

    tcp.reportedRevision = '4';
    await harness.service.update('200', { name: 'Projected' });
    expect(harness.state.desiredRevision).toBe('5');
    expect(tcp).toMatchObject({ desiredRevision: '5', name: 'Projected' });
    expect(udp).toMatchObject({ desiredRevision: '5', name: 'Projected' });
    expect(group.name).toBe('Projected');
    await expect(harness.service.list()).resolves.toMatchObject({
      items: [{ appliedProtocolMode: null }],
    });
  });

  it('compares the expected TCP desired revision before both mutation and no-op handling', async () => {
    const group = createGroup({ protocolMode: 'tcp' });
    const tcp = createMapping({
      natmapDesiredEnabled: false,
      protocol: 'tcp',
    });
    const harness = createHarness([group], [tcp]);

    await expect(
      harness.service.enableNatmap('200', '2'),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(tcp.natmapDesiredEnabled).toBe(false);
    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();

    await expect(
      harness.service.enableNatmap('200', '3'),
    ).resolves.toMatchObject({
      desiredRevision: '4',
      natmapDesiredEnabled: true,
    });
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);

    await expect(
      harness.service.enableNatmap('200', '3'),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(harness.state.desiredRevision).toBe('4');
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);

    await expect(
      harness.service.enableNatmap('200', '4'),
    ).resolves.toMatchObject({
      desiredRevision: '4',
      natmapDesiredEnabled: true,
    });
    expect(harness.state.desiredRevision).toBe('4');
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(1);
  });

  it('keeps removed protocols as tombstones and never resurrects a prior channel ID', async () => {
    const group = createGroup();
    const tcp = createMapping({ protocol: 'tcp' });
    const udp = createMapping({ protocol: 'udp' });
    const harness = createHarness([group], [tcp, udp]);

    await harness.service.update('200', { protocolMode: 'udp' });
    expect(tcp).toMatchObject({
      activeGroupProtocolKey: '200:tcp',
      activeKey: 'tcp:9000',
      desiredPresence: 'absent',
      desiredRevision: '4',
      isDeleted: false,
      syncStatus: 'deleting',
    });
    expect(udp.desiredRevision).toBe('3');
    expect(group.isDeleted).toBe(false);

    await harness.service
      .update('200', { protocolMode: 'tcp_udp' })
      .catch((error) => expect(errorStatus(error)).toBe(409));
    expect(harness.mappings).toHaveLength(2);

    const persistedTcp = harness.mappings.find(
      (mapping) => mapping.protocol === 'tcp',
    )!;
    const persistedUdp = harness.mappings.find(
      (mapping) => mapping.protocol === 'udp',
    )!;
    persistedTcp.isDeleted = true;
    persistedTcp.activeKey = null;
    persistedTcp.activeGroupProtocolKey = null;
    persistedUdp.syncStatus = 'synced';
    await harness.service.update('200', { protocolMode: 'tcp_udp' });
    const replacement = harness.mappings.find(
      (mapping) => !mapping.isDeleted && mapping.protocol === 'tcp',
    );
    expect(replacement?.id).not.toBe('101');
    expect(replacement).toMatchObject({
      activeGroupProtocolKey: '200:tcp',
      activeKey: 'tcp:9000',
      desiredPresence: 'present',
      isDeleted: false,
    });
  });

  it('marks every channel absent on group delete without soft-deleting channels or the group', async () => {
    const group = createGroup();
    const tcp = createMapping({
      currentPublicIpv4: '8.8.8.8',
      currentPublicPort: 45000,
      natmapDesiredEnabled: true,
      protocol: 'tcp',
    });
    const udp = createMapping({
      currentPublicIpv4: '1.1.1.1',
      currentPublicPort: 45001,
      keeperDesiredEnabled: true,
      protocol: 'udp',
    });
    const harness = createHarness([group], [tcp, udp]);

    await harness.service.remove('200');
    expect(group.isDeleted).toBe(false);
    expect(harness.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          desiredPresence: 'absent',
          isDeleted: false,
          natmapDesiredEnabled: false,
        }),
        expect.objectContaining({
          desiredPresence: 'absent',
          isDeleted: false,
          keeperDesiredEnabled: false,
        }),
      ]),
    );
    expect(harness.mappings.every((mapping) => mapping.activeKey)).toBe(true);
    tcp.reportedRevision = tcp.desiredRevision;
    udp.reportedRevision = udp.desiredRevision;
    await harness.service.list();
    expect(group.isDeleted).toBe(false);
    expect(harness.mappings.every((mapping) => !mapping.isDeleted)).toBe(true);
  });

  it('fails an atomic dual-channel create without partial state at the 64-channel limit', async () => {
    const existing = Array.from({ length: 63 }, (_, index) =>
      createMapping({
        activeGroupProtocolKey: `${300 + index}:udp`,
        activeKey: `udp:${10000 + index}`,
        externalPort: 10000 + index,
        groupId: String(300 + index),
        id: String(1000 + index),
        internalPort: 10000 + index,
      }),
    );
    const harness = createHarness([], existing);

    await harness.service
      .create({
        externalPort: 9000,
        internalPort: 9000,
        name: 'too many',
        protocolMode: 'tcp_udp',
      })
      .catch((error) => expect(errorStatus(error)).toBe(409));
    expect(harness.groups).toHaveLength(0);
    expect(harness.mappings).toHaveLength(63);
    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });

  it('keeps UDP Keeper switches idempotent and filters history by channel mechanism', async () => {
    const group = createGroup({ protocolMode: 'udp' });
    const udp = createMapping({ protocol: 'udp' });
    const harness = createHarness([group], [udp]);
    harness.histories.push(
      Object.assign(new NetworkEndpointHistory(), {
        eventId: 'udp-event',
        id: '300',
        mappingId: '100',
        mechanism: 'udp_stun',
      }),
      Object.assign(new NetworkEndpointHistory(), {
        eventId: 'wrong-mechanism',
        id: '301',
        mappingId: '100',
        mechanism: 'tcp_natmap',
      }),
    );

    await harness.service.enableKeeper('200');
    const enableRevision = harness.state.desiredRevision;
    await harness.service.enableKeeper('200');
    expect(harness.state.desiredRevision).toBe(enableRevision);
    udp.syncStatus = 'synced';
    await harness.service.disableKeeper('200');
    const disableRevision = harness.state.desiredRevision;
    await harness.service.disableKeeper('200');
    expect(harness.state.desiredRevision).toBe(disableRevision);
    expect(harness.mqtt.requestDesiredPublish).toHaveBeenCalledTimes(2);

    await expect(
      harness.service.endpointHistory('200', 'udp'),
    ).resolves.toMatchObject({
      items: [{ eventId: 'udp-event', mechanism: 'udp_stun' }],
      total: 1,
    });
    await harness.service
      .enableNatmap('200')
      .catch((error) => expect(errorStatus(error)).toBe(400));
  });

  it('treats an already-disabled asymmetric UDP Keeper switch as a no-op', async () => {
    const group = createGroup({
      externalPort: 9000,
      internalPort: 9001,
      protocolMode: 'udp',
    });
    const udp = createMapping({
      externalPort: 9000,
      internalPort: 9001,
      keeperDesiredEnabled: false,
      protocol: 'udp',
    });
    const harness = createHarness([group], [udp]);

    await expect(harness.service.disableKeeper('200')).resolves.toMatchObject({
      desiredRevision: '3',
      keeperDesiredEnabled: false,
    });
    expect(harness.state.desiredRevision).toBe('3');
    expect(harness.mqtt.requestDesiredPublish).not.toHaveBeenCalled();
  });
});
