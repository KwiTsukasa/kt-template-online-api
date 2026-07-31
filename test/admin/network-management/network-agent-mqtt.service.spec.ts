import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { IClientOptions, MqttClient } from 'mqtt';
import { KtDateTime } from '../../../src/common';
import {
  NetworkAgentMqttService,
  type NetworkMqttClientFactory,
} from '../../../src/modules/admin/platform-config/network-management/network-agent-mqtt.service';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkEndpointHistory } from '../../../src/modules/admin/platform-config/network-management/network-endpoint-history.entity';
import type { NetworkManagementEventStreamService } from '../../../src/modules/admin/platform-config/network-management/network-management-event-stream.service';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.entity';
import {
  buildDesiredSnapshotV2,
  endpointLeaseIdentityV2,
} from '../../../src/modules/admin/platform-config/network-management/network-agent-v2.types';
import type {
  SystemMessageEventInput,
  SystemMessageEventStager,
} from '../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import {
  buildDesiredSnapshot,
  desiredSnapshotDigest,
} from '../../../src/modules/admin/platform-config/network-management/network-management.types';

type MqttHarness = {
  client: MqttClient & EventEmitter;
  clientOptions: () => IClientOptions;
  deliveryCoordinator: { requestDrain: jest.Mock };
  group: NetworkPortForwardGroup;
  histories: NetworkEndpointHistory[];
  historyFindOne: jest.Mock;
  historySave: jest.Mock;
  mappingFindOne: jest.Mock;
  mappingSave: jest.Mock;
  operations: string[];
  publishCommitted: jest.Mock;
  mapping: NetworkPortForward;
  publishCallback: () => (error?: Error) => void;
  requestDdnsReconcile: jest.Mock;
  service: NetworkAgentMqttService;
  stagedEvents: SystemMessageEventInput[];
  stager: jest.Mocked<SystemMessageEventStager>;
  state: NetworkAgentState;
  stateFindOne: jest.Mock;
  stateSave: jest.Mock;
  transactionCalls: () => number;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

type ConcurrentEndpointHarness = {
  historyStageEntered: Promise<void>;
  histories: NetworkEndpointHistory[];
  releaseFirstStage: () => void;
  service: NetworkAgentMqttService;
  stageCalls: SystemMessageEventInput[];
  stagedEvents: SystemMessageEventInput[];
};

type V2MqttHarness = {
  channels: NetworkPortForward[];
  deliveryCoordinator: { requestDrain: jest.Mock };
  groups: NetworkPortForwardGroup[];
  histories: NetworkEndpointHistory[];
  historySave: jest.Mock;
  mappingFindOne: jest.Mock;
  mappingSave: jest.Mock;
  operations: string[];
  publishCommitted: jest.Mock;
  requestDdnsReconcile: jest.Mock;
  service: NetworkAgentMqttService;
  stagedEvents: SystemMessageEventInput[];
  stager: jest.Mocked<SystemMessageEventStager>;
  state: NetworkAgentState;
  stateFindOne: jest.Mock;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness(): MqttHarness {
  const operations: string[] = [];
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '0',
    appliedSchemaVersion: 1,
    desiredIssuedAt: new KtDateTime('2026-07-22T01:02:03.000Z'),
    desiredRevision: '7',
    online: false,
    publishedRevision: '0',
    targetIpv4: '192.168.31.224',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    activeGroupProtocolKey: '10:udp',
    activeKey: 'udp:9000',
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidUntil: null,
    desiredIssuedAt: state.desiredIssuedAt,
    desiredPresence: 'present',
    desiredRevision: '7',
    externalPort: 9000,
    groupId: '10',
    id: '100',
    internalPort: 9000,
    isDeleted: false,
    keeperDesiredEnabled: true,
    keeperStatus: 'starting',
    name: 'rule',
    protocol: 'udp',
    reportedRevision: '0',
    syncStatus: 'pending',
    targetIpv4: '192.168.31.224',
  });
  const group = Object.assign(new NetworkPortForwardGroup(), {
    externalPort: 9000,
    id: '10',
    internalPort: 9000,
    isDeleted: false,
    name: 'rule',
    protocolMode: 'udp',
    targetIpv4: '192.168.31.224',
  });
  const histories: NetworkEndpointHistory[] = [];
  const stateSave = jest.fn(async (value) => Object.assign(state, value));
  const stateFindOne = jest.fn(async () => state);
  const stateRepository = {
    findOne: stateFindOne,
    save: stateSave,
  } as unknown as Repository<NetworkAgentState>;
  const mappingSave = jest.fn(async (value) => Object.assign(mapping, value));
  const mappingFindOne = jest.fn(async ({ where }) =>
    where.id === mapping.id ? mapping : null,
  );
  const mappingRepository = {
    find: async ({ where } = {} as any) => {
      if (where?.groupId === mapping.groupId) return [mapping];
      return mapping.isDeleted ? [] : [mapping];
    },
    findOne: mappingFindOne,
    save: mappingSave,
  } as unknown as Repository<NetworkPortForward>;
  const groupRepository = {
    find: async () => (group.isDeleted ? [] : [group]),
    findOne: async ({ where }) => (where.id === group.id ? group : null),
    save: jest.fn(async (value) => Object.assign(group, value)),
  } as unknown as Repository<NetworkPortForwardGroup>;
  const historyFindOne = jest.fn(async ({ order, where }) => {
    if (where.eventId) {
      return histories.find((item) => item.eventId === where.eventId) || null;
    }
    const matches = histories.filter(
      (item) => item.mappingId === where.mappingId,
    );
    if (!order) return matches[0] || null;
    return (
      [...matches].sort((left, right) => {
        for (const [key, direction] of Object.entries(order)) {
          const leftValue = left[key as keyof NetworkEndpointHistory];
          const rightValue = right[key as keyof NetworkEndpointHistory];
          const compare =
            leftValue instanceof Date && rightValue instanceof Date
              ? leftValue.getTime() - rightValue.getTime()
              : String(leftValue).localeCompare(String(rightValue));
          if (compare !== 0) return direction === 'DESC' ? -compare : compare;
        }
        return 0;
      })[0] || null
    );
  });
  const historySave = jest.fn(async (value: NetworkEndpointHistory) => {
    value.id ||= String(histories.length + 1);
    histories.push(value);
    return value;
  });
  const historyRepository = {
    create: (input) => Object.assign(new NetworkEndpointHistory(), input),
    findOne: historyFindOne,
    save: historySave,
  } as unknown as Repository<NetworkEndpointHistory>;
  const manager = {
    getRepository: (entity) => {
      if (entity === NetworkAgentState) return stateRepository;
      if (entity === NetworkPortForward) return mappingRepository;
      if (entity === NetworkPortForwardGroup) return groupRepository;
      if (entity === NetworkEndpointHistory) return historyRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  const stagedEvents: SystemMessageEventInput[] = [];
  const stager = {
    stage: jest.fn(async (_manager, input) => {
      operations.push('stager:accepted');
      stagedEvents.push(input);
      return 'accepted' as const;
    }),
  } as jest.Mocked<SystemMessageEventStager>;
  let transactionCallCount = 0;
  const dataSource = {
    getRepository: manager.getRepository.bind(manager),
    transaction: async (work) => {
      transactionCallCount += 1;
      operations.push('transaction:start');
      const historiesBefore = [...histories];
      const stagedEventsBefore = [...stagedEvents];
      try {
        const result = await work(manager);
        operations.push('transaction:commit');
        return result;
      } catch (error) {
        histories.splice(0, histories.length, ...historiesBefore);
        stagedEvents.splice(0, stagedEvents.length, ...stagedEventsBefore);
        operations.push('transaction:rollback');
        throw error;
      }
    },
  } as unknown as DataSource;
  const configService = {
    get: (key) => {
      const values = {
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_AGENT_MQTT_RETRY_MS: '60000',
        NETWORK_AGENT_MQTT_URL: 'mqtt://broker.test:1883',
      };
      return values[key];
    },
  } as ConfigService;

  const client = new EventEmitter() as MqttClient & EventEmitter;
  client.connected = true;
  let options: IClientOptions;
  let publishAck: (error?: Error) => void = () => undefined;
  client.subscribe = jest.fn((_topics, optionsOrCallback, callback) => {
    const done =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    done?.(undefined, []);
    return client;
  }) as unknown as MqttClient['subscribe'];
  client.publish = jest.fn((_topic, _payload, _options, callback) => {
    publishAck = callback as (error?: Error) => void;
    return client;
  }) as unknown as MqttClient['publish'];
  client.reconnect = jest.fn(() => client) as MqttClient['reconnect'];
  client.end = jest.fn((_force, _opts, callback) => {
    callback?.();
    return client;
  }) as unknown as MqttClient['end'];
  const factory: NetworkMqttClientFactory = (_url, clientOptions) => {
    options = clientOptions;
    return client;
  };
  const publishCommitted = jest.fn();
  const eventStream = {
    publishCommitted,
  } as unknown as NetworkManagementEventStreamService;
  const requestDdnsReconcile = jest.fn();
  const deliveryCoordinator = {
    notifyDdnsSynced: jest.fn().mockResolvedValue(undefined),
    requestDrain: jest.fn(() => {
      operations.push('delivery:wake');
    }),
  };
  const service = new NetworkAgentMqttService(
    configService,
    dataSource,
    eventStream,
    stager,
    deliveryCoordinator,
    factory,
    { requestReconcile: requestDdnsReconcile } as never,
  );
  return {
    client,
    clientOptions: () => options,
    deliveryCoordinator,
    group,
    histories,
    historyFindOne,
    historySave,
    mappingFindOne,
    mappingSave,
    mapping,
    operations,
    publishCallback: () => publishAck,
    publishCommitted,
    requestDdnsReconcile,
    service,
    stagedEvents,
    state,
    stateFindOne,
    stateSave,
    stager,
    transactionCalls: () => transactionCallCount,
  };
}

function createV2Harness(): V2MqttHarness {
  const operations: string[] = [];
  const issuedAt = new KtDateTime('2099-07-27T00:00:00.000Z');
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '0',
    appliedSchemaVersion: 1,
    desiredIssuedAt: issuedAt,
    desiredRevision: '7',
    desiredSchemaVersion: 2,
    maxSupportedSchemaVersion: 2,
    online: true,
    publishedRevision: '7',
    publishedSchemaVersion: 2,
    targetIpv4: '192.168.31.224',
    tcpNatmapCapable: true,
  });
  const group = Object.assign(new NetworkPortForwardGroup(), {
    externalPort: 8213,
    id: '10',
    internalPort: 8213,
    isDeleted: false,
    name: '双协议规则',
    protocolMode: 'tcp_udp',
    targetIpv4: '192.168.31.224',
  });
  const channelBase = {
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidatedAt: null,
    currentValidUntil: null,
    desiredIssuedAt: issuedAt,
    desiredPresence: 'present' as const,
    desiredRevision: '7',
    externalPort: 8213,
    groupId: group.id,
    internalPort: 8213,
    isDeleted: false,
    lastObservedAt: null,
    lastObservedIpv4: null,
    lastObservedPort: null,
    lastObservedValidatedAt: null,
    name: group.name,
    reportedRevision: '0',
    syncStatus: 'pending' as const,
    targetIpv4: '192.168.31.224',
  };
  const tcp = Object.assign(new NetworkPortForward(), channelBase, {
    activeGroupProtocolKey: '10:tcp',
    activeKey: 'tcp:8213',
    id: '101',
    keeperDesiredEnabled: false,
    keeperStatus: 'disabled',
    natmapDesiredEnabled: true,
    natmapStatus: 'starting',
    protocol: 'tcp',
  });
  const udp = Object.assign(new NetworkPortForward(), channelBase, {
    activeGroupProtocolKey: '10:udp',
    activeKey: 'udp:8213',
    id: '102',
    keeperDesiredEnabled: true,
    keeperStatus: 'starting',
    natmapDesiredEnabled: false,
    natmapStatus: 'disabled',
    protocol: 'udp',
  });
  const channels = [tcp, udp];
  const groups = [group];
  const histories: NetworkEndpointHistory[] = [];
  const stagedEvents: SystemMessageEventInput[] = [];
  const mappingSave = jest.fn(async (value) => value);
  const groupSave = jest.fn(async (value) => value);
  const historySave = jest.fn(async (value: NetworkEndpointHistory) => {
    value.id ||= String(histories.length + 1);
    histories.push(value);
    return value;
  });
  const stateSave = jest.fn(async (value) => value);
  const matchesWhere = (
    value: Record<string, unknown>,
    where: Record<string, unknown> = {},
  ) =>
    Object.entries(where).every(([key, expected]) => {
      if (
        expected &&
        typeof expected === 'object' &&
        (expected as { _type?: unknown })._type === 'not'
      ) {
        return value[key] !== (expected as { _value?: unknown })._value;
      }
      return value[key] === expected;
    });
  const mappingFindOne = jest.fn(
    async ({ where }) =>
      channels.find((channel) =>
        matchesWhere(channel as unknown as Record<string, unknown>, where),
      ) || null,
  );
  const mappingRepository = {
    find: async ({ where } = {} as any) =>
      channels.filter((channel) =>
        matchesWhere(channel as unknown as Record<string, unknown>, where),
      ),
    findOne: mappingFindOne,
    save: mappingSave,
  } as unknown as Repository<NetworkPortForward>;
  const groupRepository = {
    find: async ({ where } = {} as any) =>
      groups.filter((item) =>
        matchesWhere(item as unknown as Record<string, unknown>, where),
      ),
    findOne: async ({ where }) =>
      groups.find((item) =>
        matchesWhere(item as unknown as Record<string, unknown>, where),
      ) || null,
    save: groupSave,
  } as unknown as Repository<NetworkPortForwardGroup>;
  const historyRepository = {
    create: (input) => Object.assign(new NetworkEndpointHistory(), input),
    find: async ({ order, take, where }) => {
      const matches = histories.filter((history) =>
        matchesWhere(history as unknown as Record<string, unknown>, where),
      );
      const sorted = [...matches].sort((left, right) => {
        for (const [key, direction] of Object.entries(order || {})) {
          const leftValue = left[key as keyof NetworkEndpointHistory];
          const rightValue = right[key as keyof NetworkEndpointHistory];
          const compare =
            leftValue instanceof Date && rightValue instanceof Date
              ? leftValue.getTime() - rightValue.getTime()
              : String(leftValue).localeCompare(String(rightValue));
          if (compare !== 0) return direction === 'DESC' ? -compare : compare;
        }
        return 0;
      });
      return take ? sorted.slice(0, take) : sorted;
    },
    findOne: async ({ order, where }) => {
      const matches = histories.filter((history) =>
        matchesWhere(history as unknown as Record<string, unknown>, where),
      );
      if (!order) return matches[0] || null;
      return (
        [...matches].sort((left, right) => {
          for (const [key, direction] of Object.entries(order)) {
            const leftValue = left[key as keyof NetworkEndpointHistory];
            const rightValue = right[key as keyof NetworkEndpointHistory];
            const compare =
              leftValue instanceof Date && rightValue instanceof Date
                ? leftValue.getTime() - rightValue.getTime()
                : String(leftValue).localeCompare(String(rightValue));
            if (compare !== 0) return direction === 'DESC' ? -compare : compare;
          }
          return 0;
        })[0] || null
      );
    },
    save: historySave,
  } as unknown as Repository<NetworkEndpointHistory>;
  const stateFindOne = jest.fn(async () => state);
  const stateRepository = {
    findOne: stateFindOne,
    save: stateSave,
  } as unknown as Repository<NetworkAgentState>;
  const manager = {
    getRepository: (entity) => {
      if (entity === NetworkAgentState) return stateRepository;
      if (entity === NetworkPortForward) return mappingRepository;
      if (entity === NetworkPortForwardGroup) return groupRepository;
      if (entity === NetworkEndpointHistory) return historyRepository;
      throw new Error('unexpected v2 repository');
    },
  } as unknown as EntityManager;
  const stager = {
    stage: jest.fn(async (_manager, input) => {
      operations.push('stager:accepted');
      stagedEvents.push(input);
      return 'accepted' as const;
    }),
  } as jest.Mocked<SystemMessageEventStager>;
  const dataSource = {
    getRepository: manager.getRepository.bind(manager),
    transaction: async (work) => {
      operations.push('transaction:start');
      const stateBefore = Object.assign(new NetworkAgentState(), state);
      const channelsBefore = channels.map((channel) =>
        Object.assign(new NetworkPortForward(), channel),
      );
      const groupsBefore = groups.map((item) =>
        Object.assign(new NetworkPortForwardGroup(), item),
      );
      const historiesBefore = [...histories];
      const stagedEventsBefore = [...stagedEvents];
      try {
        const result = await work(manager);
        operations.push('transaction:commit');
        return result;
      } catch (error) {
        Object.assign(state, stateBefore);
        for (const snapshot of channelsBefore) {
          const channel = channels.find((item) => item.id === snapshot.id);
          if (channel) Object.assign(channel, snapshot);
        }
        for (const snapshot of groupsBefore) {
          const item = groups.find((candidate) => candidate.id === snapshot.id);
          if (item) Object.assign(item, snapshot);
        }
        histories.splice(0, histories.length, ...historiesBefore);
        stagedEvents.splice(0, stagedEvents.length, ...stagedEventsBefore);
        operations.push('transaction:rollback');
        throw error;
      }
    },
  } as unknown as DataSource;
  const publishCommitted = jest.fn(() => operations.push('sse'));
  const requestDdnsReconcile = jest.fn(() => operations.push('ddns:wake'));
  const deliveryCoordinator = {
    requestDrain: jest.fn(() => operations.push('delivery:wake')),
  };
  const service = new NetworkAgentMqttService(
    {
      get: (key: string) =>
        ({
          NETWORK_AGENT_ID: 'nas-main',
          NETWORK_AGENT_MQTT_RETRY_MS: '60000',
        })[key],
    } as ConfigService,
    dataSource,
    { publishCommitted } as never,
    stager,
    deliveryCoordinator as never,
    undefined,
    { requestReconcile: requestDdnsReconcile } as never,
  );
  return {
    channels,
    deliveryCoordinator,
    groups,
    histories,
    historySave,
    mappingFindOne,
    mappingSave,
    operations,
    publishCommitted,
    requestDdnsReconcile,
    service,
    stagedEvents,
    stager,
    state,
    stateFindOne,
  };
}

function v2Endpoint(
  mechanism: 'tcp_natmap' | 'udp_stun',
  overrides: Record<string, unknown> = {},
) {
  return {
    mechanism,
    observedAt: '2099-07-27T00:00:00.000Z',
    publicIpv4: mechanism === 'tcp_natmap' ? '8.8.8.8' : '8.8.4.4',
    publicPort: mechanism === 'tcp_natmap' ? 45101 : 45102,
    validatedAt: '2099-07-27T00:00:05.000Z',
    validUntil: '2099-07-27T00:00:45.000Z',
    ...overrides,
  };
}

function v2Reported(
  harness: V2MqttHarness,
  channelOverrides: Record<string, Record<string, unknown>> = {},
  snapshotOverrides: Record<string, unknown> = {},
): Buffer {
  const activeChannels = harness.channels.filter(
    (channel) => !channel.isDeleted,
  );
  const desired = buildDesiredSnapshotV2(harness.state, activeChannels);
  const desiredById = new Map(
    desired.channels.map((channel) => [channel.channelId, channel]),
  );
  const channels = activeChannels.map((channel) => {
    const desiredChannel = desiredById.get(channel.id);
    if (!desiredChannel) throw new Error('missing desired channel');
    const present = channel.desiredPresence === 'present';
    if (channel.protocol === 'tcp') {
      const endpoint = v2Endpoint('tcp_natmap');
      return {
        appliedDesiredDigest: desiredChannel.channelDesiredDigest,
        appliedDesiredRevision: desiredChannel.channelDesiredRevision,
        ...(present
          ? {
              candidateEndpoint: endpoint,
              currentEndpoint: endpoint,
              lastObservedEndpoint: endpoint,
            }
          : {}),
        channelId: channel.id,
        desiredPresence: channel.desiredPresence,
        dnatPresent: present,
        groupId: channel.groupId,
        ...(present ? { instanceGeneration: 'generation-1' } : {}),
        natmapDesiredEnabled: channel.natmapDesiredEnabled,
        natmapStatus: present ? 'active' : 'disabled',
        protocol: 'tcp',
        routerPresent: present,
        syncStatus: 'synced',
        ...channelOverrides[channel.id],
      };
    }
    const endpoint = v2Endpoint('udp_stun');
    return {
      appliedDesiredDigest: desiredChannel.channelDesiredDigest,
      appliedDesiredRevision: desiredChannel.channelDesiredRevision,
      channelId: channel.id,
      ...(present
        ? { currentEndpoint: endpoint, lastObservedEndpoint: endpoint }
        : {}),
      desiredPresence: channel.desiredPresence,
      groupId: channel.groupId,
      keeperDesiredEnabled: channel.keeperDesiredEnabled,
      keeperStatus: present ? 'active' : 'disabled',
      protocol: 'udp',
      routePresent: present,
      routerPresent: present,
      syncStatus: 'synced',
      ...channelOverrides[channel.id],
    };
  });
  return Buffer.from(
    JSON.stringify({
      agentId: 'nas-main',
      channels,
      reportedAt: '2099-07-27T00:00:10.000Z',
      schemaVersion: 2,
      snapshotDigest: desired.snapshotDigest,
      snapshotRevision: desired.snapshotRevision,
      ...snapshotOverrides,
    }),
  );
}

function v2EndpointEvent(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      agentId: 'nas-main',
      channelId: '102',
      endpoint: v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      }),
      eventId: 'v2-endpoint-event-2',
      groupId: '10',
      mechanism: 'udp_stun',
      occurredAt: '2099-07-27T00:00:16.000Z',
      protocol: 'udp',
      revision: 7,
      schemaVersion: 2,
      type: 'changed',
      ...overrides,
    }),
  );
}

function createConcurrentEndpointHarness(): ConcurrentEndpointHarness {
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    desiredRevision: '7',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    id: '100',
    isDeleted: false,
  });
  const histories = [endpointHistory({ publicPort: 8213 })];
  const stageCalls: SystemMessageEventInput[] = [];
  const stagedEvents: SystemMessageEventInput[] = [];
  const firstStageEntered = createDeferred<void>();
  const firstStageReleased = createDeferred<void>();
  const transactions = new WeakMap<
    object,
    {
      pendingHistories: NetworkEndpointHistory[];
      pendingStagedEvents: SystemMessageEventInput[];
      releaseMappingLock?: () => void;
    }
  >();
  let mappingLockTail = Promise.resolve();

  async function acquireMappingLock(manager: object): Promise<void> {
    const predecessor = mappingLockTail;
    const released = createDeferred<void>();
    mappingLockTail = released.promise;
    await predecessor;
    const transaction = transactions.get(manager);
    if (transaction) {
      transaction.releaseMappingLock = () => released.resolve(undefined);
    }
  }

  function findNewestHistory(
    rows: readonly NetworkEndpointHistory[],
    order: Record<string, 'ASC' | 'DESC'>,
  ): NetworkEndpointHistory | null {
    return (
      [...rows].sort((left, right) => {
        for (const [key, direction] of Object.entries(order)) {
          const leftValue = left[key as keyof NetworkEndpointHistory];
          const rightValue = right[key as keyof NetworkEndpointHistory];
          const compare =
            leftValue instanceof Date && rightValue instanceof Date
              ? leftValue.getTime() - rightValue.getTime()
              : String(leftValue).localeCompare(String(rightValue));
          if (compare !== 0) return direction === 'DESC' ? -compare : compare;
        }
        return 0;
      })[0] || null
    );
  }

  const stager = {
    stage: jest.fn(
      async (manager: EntityManager, input: SystemMessageEventInput) => {
        stageCalls.push(input);
        if (input.eventId === 'endpoint-event-2') {
          firstStageEntered.resolve(undefined);
          await firstStageReleased.promise;
        }
        const transaction = transactions.get(manager);
        if (!transaction)
          throw new Error('missing transaction-local Outbox state');
        transaction.pendingStagedEvents.push(input);
        return 'accepted' as const;
      },
    ),
  } as jest.Mocked<SystemMessageEventStager>;
  const dataSource = {
    transaction: async (work) => {
      const pendingHistories: NetworkEndpointHistory[] = [];
      const pendingStagedEvents: SystemMessageEventInput[] = [];
      const manager = {
        getRepository: (entity) => {
          if (entity === NetworkAgentState) {
            return {
              findOne: async () => state,
            } as unknown as Repository<NetworkAgentState>;
          }
          if (entity === NetworkPortForward) {
            return {
              findOne: async ({ lock, where }) => {
                if (where.id !== mapping.id) return null;
                if (lock?.mode === 'pessimistic_write') {
                  await acquireMappingLock(manager);
                }
                return mapping;
              },
            } as unknown as Repository<NetworkPortForward>;
          }
          if (entity === NetworkEndpointHistory) {
            return {
              create: (input) =>
                Object.assign(new NetworkEndpointHistory(), input),
              findOne: async ({ order, where }) => {
                const visible = [...histories, ...pendingHistories];
                if (where.eventId) {
                  return (
                    visible.find((item) => item.eventId === where.eventId) ||
                    null
                  );
                }
                return findNewestHistory(
                  visible.filter((item) => item.mappingId === where.mappingId),
                  order,
                );
              },
              save: async (history: NetworkEndpointHistory) => {
                history.id ||= String(
                  histories.length + pendingHistories.length + 1,
                );
                pendingHistories.push(history);
                return history;
              },
            } as unknown as Repository<NetworkEndpointHistory>;
          }
          throw new Error('unexpected repository');
        },
      } as unknown as EntityManager;
      transactions.set(manager, { pendingHistories, pendingStagedEvents });
      try {
        const result = await work(manager);
        histories.push(...pendingHistories);
        stagedEvents.push(...pendingStagedEvents);
        return result;
      } finally {
        transactions.get(manager)?.releaseMappingLock?.();
      }
    },
  } as unknown as DataSource;
  const configService = {
    get: (key) =>
      ({
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_AGENT_MQTT_RETRY_MS: '60000',
      })[key],
  } as ConfigService;
  const service = new NetworkAgentMqttService(
    configService,
    dataSource,
    { publishCommitted: jest.fn() } as never,
    stager,
    {
      notifyDdnsSynced: jest.fn().mockResolvedValue(undefined),
      requestDrain: jest.fn(),
    },
  );
  return {
    historyStageEntered: firstStageEntered.promise,
    histories,
    releaseFirstStage: () => firstStageReleased.resolve(undefined),
    service,
    stageCalls,
    stagedEvents,
  };
}

function endpointEvent(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      agentId: 'nas-main',
      endpoint: {
        observedAt: '2026-07-22T01:02:04.000Z',
        publicIpv4: '8.8.4.4',
        publicPort: 38213,
        validUntil: '2026-07-22T01:04:04.000Z',
      },
      eventId: 'endpoint-event-2',
      mappingId: '100',
      occurredAt: '2026-07-22T01:02:05.000Z',
      revision: 7,
      schemaVersion: 1,
      type: 'changed',
      ...overrides,
    }),
  );
}

function endpointHistory(
  overrides: Partial<NetworkEndpointHistory> = {},
): NetworkEndpointHistory {
  return Object.assign(new NetworkEndpointHistory(), {
    eventId: 'endpoint-event-1',
    eventType: 'changed',
    id: '1',
    mappingId: '100',
    occurredAt: new KtDateTime('2026-07-22T01:02:03.000Z'),
    publicIpv4: '8.8.8.8',
    publicPort: 8213,
    ...overrides,
  });
}

function v2EndpointHistory(
  overrides: Partial<NetworkEndpointHistory> = {},
): NetworkEndpointHistory {
  const endpoint = v2Endpoint('udp_stun');
  return Object.assign(new NetworkEndpointHistory(), {
    endpointValidatedAt: new KtDateTime('2099-07-27T00:00:05.000Z'),
    endpointValidUntil: new KtDateTime('2099-07-27T00:00:45.000Z'),
    endpointIdentity: endpointLeaseIdentityV2(endpoint),
    eventId: 'v2-endpoint-event-1',
    eventType: 'published',
    firstObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
    id: '1',
    lastObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
    mappingId: '102',
    mechanism: 'udp_stun',
    occurredAt: new KtDateTime('2099-07-27T00:00:01.000Z'),
    publicIpv4: '8.8.4.4',
    publicPort: 45102,
    sourceRevision: '7',
    ...overrides,
  });
}

function seedV2TcpWithdrawalHistory(
  harness: V2MqttHarness,
  previousEndpoint: ReturnType<typeof v2Endpoint>,
): void {
  harness.histories.push(
    v2EndpointHistory({
      endpointIdentity: endpointLeaseIdentityV2(previousEndpoint),
      endpointValidatedAt: new KtDateTime(previousEndpoint.validatedAt),
      endpointValidUntil: new KtDateTime(previousEndpoint.validUntil),
      eventId: 'v2-tcp-event-0',
      mappingId: '101',
      mechanism: 'tcp_natmap',
      publicIpv4: previousEndpoint.publicIpv4,
      publicPort: previousEndpoint.publicPort,
    }),
    v2EndpointHistory({
      endpointIdentity: null,
      endpointValidatedAt: null,
      endpointValidUntil: null,
      eventId: 'v2-tcp-withdrawn-1',
      eventType: 'withdrawn',
      id: '2',
      mappingId: '101',
      mechanism: 'tcp_natmap',
      occurredAt: new KtDateTime('2099-07-27T00:00:10.000Z'),
      publicIpv4: null,
      publicPort: null,
    }),
  );
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createProtocolAck(
  client: MqttClient & EventEmitter,
): jest.Mock<void, [Error | number, number?]> {
  return jest.fn((error: Error | number) => {
    if (error instanceof Error) client.emit('error', error);
  });
}

function reported(
  harness: MqttHarness,
  revision: number,
  overrides: Record<string, unknown> = {},
) {
  const digest =
    revision === Number(harness.state.desiredRevision)
      ? desiredSnapshotDigest(
          buildDesiredSnapshot(harness.state, [harness.mapping]),
        )
      : 'd'.repeat(64);
  return Buffer.from(
    JSON.stringify({
      agentId: 'nas-main',
      appliedRevision: revision,
      desiredDigest: digest,
      helperAppliedRevision: revision,
      helperDigest: 'e'.repeat(64),
      helperStatus: 'confirmed',
      mappings: [
        {
          currentEndpoint: {
            observedAt: '2026-07-22T01:02:04.000Z',
            publicIpv4: '8.8.8.8',
            publicPort: 45000,
            validUntil: '2026-07-22T01:04:04.000Z',
          },
          desiredState: harness.mapping.desiredPresence,
          id: '100',
          keeperDesiredEnabled: harness.mapping.keeperDesiredEnabled,
          keeperStatus: 'active',
          lastObservedEndpoint: {
            observedAt: '2026-07-22T01:02:04.000Z',
            publicIpv4: '8.8.8.8',
            publicPort: 45000,
            validUntil: '2026-07-22T01:04:04.000Z',
          },
          revision,
          routePresent: true,
          routerPresent: true,
          syncStatus: 'synced',
          ...overrides,
        },
      ],
      reportedAt: '2026-07-22T01:02:04.000Z',
      schemaVersion: 1,
    }),
  );
}

describe('NetworkAgentMqttService', () => {
  it('delays inbound QoS 1 acknowledgement until DB consumption resolves', async () => {
    const harness = createHarness();
    let complete: () => void = () => undefined;
    jest.spyOn(harness.service, 'consumeMessage').mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    harness.service.onModuleInit();
    const ack = jest.fn();

    harness
      .clientOptions()
      .customHandleAcks?.(
        'kt/network/v1/agents/nas-main/reported',
        Buffer.from('{}'),
        { qos: 1 },
        ack,
      );
    await flushPromises();
    expect(ack).not.toHaveBeenCalled();

    complete();
    await flushPromises();
    expect(ack).toHaveBeenCalledWith(0);
    await harness.service.onModuleDestroy();
  });

  it('forces one persistent-session reconnect after a transient inbound transaction failure', async () => {
    const harness = createHarness();
    jest
      .spyOn(harness.service, 'consumeMessage')
      .mockRejectedValueOnce(new Error('database unavailable'));
    harness.service.onModuleInit();
    const ack = createProtocolAck(harness.client);

    harness
      .clientOptions()
      .customHandleAcks?.(
        'kt/network/v1/agents/nas-main/reported',
        Buffer.from('{}'),
        { qos: 1 },
        ack,
      );
    await flushPromises();

    expect(ack).toHaveBeenCalledWith(expect.any(Error));
    expect(harness.client.end).toHaveBeenCalledWith(
      true,
      {},
      expect.any(Function),
    );
    expect(harness.client.reconnect).toHaveBeenCalledTimes(1);
    expect(harness.clientOptions()).toMatchObject({
      clean: false,
      clientId: 'kt-template-online-api-network-nas-main',
    });
    harness.client.emit('error', new Error('duplicate recovery signal'));
    expect(harness.client.end).toHaveBeenCalledTimes(1);
    expect(harness.client.reconnect).toHaveBeenCalledTimes(1);
    await harness.service.onModuleDestroy();
  });

  it('acknowledges and drops permanent malformed messages without reconnecting', async () => {
    const harness = createHarness();
    harness.service.onModuleInit();
    const ack = createProtocolAck(harness.client);

    harness
      .clientOptions()
      .customHandleAcks?.(
        'kt/network/v1/agents/nas-main/reported',
        Buffer.from('{'),
        { qos: 1 },
        ack,
      );
    await flushPromises();

    expect(ack).toHaveBeenCalledWith(0);
    expect(harness.client.end).not.toHaveBeenCalled();
    expect(harness.client.reconnect).not.toHaveBeenCalled();
    await harness.service.onModuleDestroy();
  });

  it('acknowledges and drops malformed v2 status without reconnecting', async () => {
    const harness = createHarness();
    harness.service.onModuleInit();
    const ack = createProtocolAck(harness.client);

    harness
      .clientOptions()
      .customHandleAcks?.(
        'kt/network/v2/agents/nas-main/status',
        v2Status({ supportedSchemaVersions: [2] }),
        { qos: 1 },
        ack,
      );
    await flushPromises();

    expect(ack).toHaveBeenCalledWith(0);
    expect(harness.client.end).not.toHaveBeenCalled();
    expect(harness.client.reconnect).not.toHaveBeenCalled();
    await harness.service.onModuleDestroy();
  });

  it('recovers from SUBACK failure before restoring exact subscriptions and forced retained desired publication', async () => {
    const harness = createHarness();
    harness.state.publishedRevision = harness.state.desiredRevision;
    const subscribe = harness.client.subscribe as jest.Mock;
    subscribe
      .mockImplementationOnce((_topics, optionsOrCallback, callback) => {
        const done =
          typeof optionsOrCallback === 'function'
            ? optionsOrCallback
            : callback;
        done?.(new Error('SUBACK rejected'));
        return harness.client;
      })
      .mockImplementationOnce((_topics, optionsOrCallback, callback) => {
        const done =
          typeof optionsOrCallback === 'function'
            ? optionsOrCallback
            : callback;
        done?.(undefined, []);
        return harness.client;
      });
    const expectedTopics = {
      'kt/network/v1/agents/nas-main/events': { qos: 1 },
      'kt/network/v1/agents/nas-main/reported': { qos: 1 },
      'kt/network/v1/agents/nas-main/status': { qos: 1 },
      'kt/network/v2/agents/nas-main/events': { qos: 1 },
      'kt/network/v2/agents/nas-main/reported': { qos: 1 },
      'kt/network/v2/agents/nas-main/status': { qos: 1 },
    };
    harness.service.onModuleInit();

    harness.client.emit('connect');
    expect(subscribe).toHaveBeenNthCalledWith(
      1,
      expectedTopics,
      expect.any(Function),
    );
    expect(harness.client.end).toHaveBeenCalledWith(
      true,
      {},
      expect.any(Function),
    );
    expect(harness.client.reconnect).toHaveBeenCalledTimes(1);
    expect(harness.client.publish).not.toHaveBeenCalled();

    harness.client.emit('connect');
    await flushPromises();
    expect(subscribe).toHaveBeenNthCalledWith(
      2,
      expectedTopics,
      expect.any(Function),
    );
    expect(harness.client.publish).toHaveBeenCalledWith(
      'kt/network/v1/agents/nas-main/desired',
      expect.any(Buffer),
      { qos: 1, retain: true },
      expect.any(Function),
    );

    harness.publishCallback()();
    await flushPromises();
    await harness.service.onModuleDestroy();
  });

  it('does not reconnect a recovery that finishes after module shutdown', async () => {
    const harness = createHarness();
    let finishRecovery: () => void = () => undefined;
    (harness.client.end as jest.Mock).mockImplementation(
      (force, _opts, callback) => {
        if (force) finishRecovery = callback;
        else callback?.();
        return harness.client;
      },
    );
    harness.service.onModuleInit();

    harness.client.emit('error', new Error('transient protocol failure'));
    expect(harness.client.end).toHaveBeenNthCalledWith(
      1,
      true,
      {},
      expect.any(Function),
    );
    await harness.service.onModuleDestroy();
    finishRecovery();

    expect(harness.client.reconnect).not.toHaveBeenCalled();
  });

  it('uses a persistent MQTT 5 session and advances published revision only after PUBACK', async () => {
    const harness = createHarness();
    harness.service.onModuleInit();
    harness.client.emit('connect');
    await flushPromises();

    expect(harness.clientOptions()).toMatchObject({
      clean: false,
      clientId: 'kt-template-online-api-network-nas-main',
      protocolVersion: 5,
    });
    expect(harness.client.publish).toHaveBeenCalledWith(
      'kt/network/v1/agents/nas-main/desired',
      expect.any(Buffer),
      { qos: 1, retain: true },
      expect.any(Function),
    );
    expect(harness.state.publishedRevision).toBe('0');
    expect(harness.transactionCalls()).toBe(1);

    harness.publishCallback()();
    await flushPromises();
    expect(harness.state.publishedRevision).toBe('7');
    expect(harness.transactionCalls()).toBe(2);
    await harness.service.onModuleDestroy();
  });

  it('defers failed publications to the bounded retry timer instead of spinning', async () => {
    const harness = createHarness();
    harness.service.onModuleInit();

    harness.service.requestDesiredPublish();
    await flushPromises();
    expect(harness.client.publish).toHaveBeenCalledTimes(1);

    harness.publishCallback()(new Error('broker unavailable'));
    await flushPromises();
    await flushPromises();
    expect(harness.client.publish).toHaveBeenCalledTimes(1);
    expect(harness.state.publishedRevision).toBe('0');
    await harness.service.onModuleDestroy();
  });

  it('protects newer desired state from stale reported data and refreshes same-revision leases', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';

    await harness.service.consumeMessage(topic, reported(harness, 7));
    expect(harness.mapping.currentPublicPort).toBe(45000);

    harness.mapping.desiredRevision = '8';
    harness.mapping.syncStatus = 'pending';
    harness.state.desiredRevision = '8';
    await harness.service.consumeMessage(
      topic,
      reported(harness, 7, {
        currentEndpoint: {
          observedAt: '2026-07-22T01:03:04.000Z',
          publicIpv4: '8.8.4.4',
          publicPort: 49999,
          validUntil: '2026-07-22T01:05:04.000Z',
        },
      }),
    );
    expect(harness.mapping.currentPublicPort).toBe(45000);
    expect(harness.mapping.syncStatus).toBe('pending');

    await harness.service.consumeMessage(
      topic,
      reported(harness, 8, {
        currentEndpoint: {
          observedAt: '2026-07-22T01:03:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45000,
          validUntil: '2026-07-22T01:06:04.000Z',
        },
      }),
    );
    expect(harness.mapping.currentValidUntil?.toISOString()).toBe(
      '2026-07-22T01:06:04.000Z',
    );
  });

  it('publishes one Admin event only after a reported transaction changes visible state', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    const payload = reported(harness, 7);
    harness.publishCommitted.mockImplementation(() => {
      expect(harness.mapping.syncStatus).toBe('synced');
      expect(harness.state.appliedRevision).toBe('7');
    });

    await harness.service.consumeMessage(topic, payload);
    const mappingSavesAfterFirstReport = harness.mappingSave.mock.calls.length;
    const stateSavesAfterFirstReport = harness.stateSave.mock.calls.length;
    await harness.service.consumeMessage(topic, payload);

    expect(harness.mappingSave).toHaveBeenCalledTimes(
      mappingSavesAfterFirstReport,
    );
    expect(harness.stateSave).toHaveBeenCalledTimes(stateSavesAfterFirstReport);
    expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
    expect(harness.publishCommitted).toHaveBeenCalledWith('reported');
    expect(harness.requestDdnsReconcile).toHaveBeenCalledTimes(1);
  });

  it('suppresses Admin events for reported lease-only timestamp renewal', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';

    await harness.service.consumeMessage(topic, reported(harness, 7));
    harness.publishCommitted.mockClear();
    harness.requestDdnsReconcile.mockClear();
    const savesBeforeRenewal = harness.mappingSave.mock.calls.length;
    await harness.service.consumeMessage(
      topic,
      reported(harness, 7, {
        currentEndpoint: {
          observedAt: '2026-07-22T01:03:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45000,
          validUntil: '2026-07-22T01:05:04.000Z',
        },
        lastObservedEndpoint: {
          observedAt: '2026-07-22T01:03:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45000,
          validUntil: '2026-07-22T01:05:04.000Z',
        },
      }),
    );

    expect(harness.mapping.currentValidUntil?.toISOString()).toBe(
      '2026-07-22T01:05:04.000Z',
    );
    expect(harness.mapping.lastObservedAt?.toISOString()).toBe(
      '2026-07-22T01:03:04.000Z',
    );
    expect(harness.mappingSave).toHaveBeenCalledTimes(savesBeforeRenewal + 1);
    expect(harness.publishCommitted).not.toHaveBeenCalled();
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();

    await harness.service.consumeMessage(
      topic,
      reported(harness, 7, {
        currentEndpoint: {
          observedAt: '2026-07-22T01:04:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45001,
          validUntil: '2026-07-22T01:06:04.000Z',
        },
      }),
    );
    expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
    expect(harness.publishCommitted).toHaveBeenCalledWith('reported');
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
  });

  it('does not let an out-of-order same-revision withdrawal erase a newer lease', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    await harness.service.consumeMessage(topic, reported(harness, 7));

    const staleWithdrawal = JSON.parse(reported(harness, 7).toString('utf8'));
    delete staleWithdrawal.mappings[0].currentEndpoint;
    staleWithdrawal.reportedAt = '2026-07-22T01:02:03.000Z';
    await harness.service.consumeMessage(
      topic,
      Buffer.from(JSON.stringify(staleWithdrawal)),
    );

    expect(harness.mapping.currentPublicPort).toBe(45000);
  });

  it('ignores lower applied revisions and rejects a wrong digest for the current revision', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    await harness.service.consumeMessage(topic, reported(harness, 7));
    const originalPort = harness.mapping.currentPublicPort;

    await harness.service.consumeMessage(
      topic,
      reported(harness, 6, {
        currentEndpoint: undefined,
        errorCode: 'old_failure',
        errorMessage: 'stale',
        syncStatus: 'failed',
      }),
    );
    expect(harness.mapping.currentPublicPort).toBe(originalPort);
    expect(harness.mapping.lastErrorCode).toBeNull();

    const wrongDigest = JSON.parse(reported(harness, 7).toString('utf8'));
    wrongDigest.desiredDigest = 'f'.repeat(64);
    await expect(
      harness.service.consumeMessage(
        topic,
        Buffer.from(JSON.stringify(wrongDigest)),
      ),
    ).rejects.toThrow('digest');
  });

  it('rejects extra mapping IDs in a current full reported snapshot', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    const payload = JSON.parse(reported(harness, 7).toString('utf8'));
    payload.mappings.push({
      desiredState: 'absent',
      id: '999',
      keeperDesiredEnabled: false,
      keeperStatus: 'disabled',
      revision: 7,
      routePresent: false,
      routerPresent: false,
      syncStatus: 'synced',
    });

    await expect(
      harness.service.consumeMessage(
        topic,
        Buffer.from(JSON.stringify(payload)),
      ),
    ).rejects.toThrow('Unknown mapping');
  });

  it('rejects Agent Keeper intent that differs from the persisted desired state', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    harness.mapping.keeperDesiredEnabled = false;
    const payload = JSON.parse(reported(harness, 7).toString('utf8'));
    payload.mappings[0].keeperDesiredEnabled = true;

    await expect(
      harness.service.consumeMessage(
        topic,
        Buffer.from(JSON.stringify(payload)),
      ),
    ).rejects.toThrow('Keeper intent');
    expect(harness.mapping.currentPublicIpv4).toBeNull();
  });

  it.each([
    ['unknown', 0, ''],
    ['failed', 8, 'e'.repeat(64)],
    ['confirmed', 7, 'e'.repeat(64)],
  ])(
    'keeps a deletion tombstone when global helper state is not current (%s)',
    async (helperStatus, helperAppliedRevision, helperDigest) => {
      const harness = createHarness();
      const topic = 'kt/network/v1/agents/nas-main/reported';
      harness.mapping.desiredPresence = 'absent';
      harness.mapping.desiredRevision = '8';
      harness.mapping.keeperDesiredEnabled = false;
      harness.mapping.syncStatus = 'deleting';
      harness.state.desiredRevision = '8';
      const payload = JSON.parse(
        reported(harness, 8, {
          currentEndpoint: undefined,
          desiredState: 'absent',
          keeperDesiredEnabled: false,
          keeperStatus: 'disabled',
          routePresent: false,
          routerPresent: false,
        }).toString('utf8'),
      );
      payload.helperAppliedRevision = helperAppliedRevision;
      payload.helperDigest = helperDigest;
      payload.helperStatus = helperStatus;

      await harness.service.consumeMessage(
        topic,
        Buffer.from(JSON.stringify(payload)),
      );

      expect(harness.mapping.isDeleted).toBe(false);
      expect(harness.mapping.activeKey).toBe('udp:9000');
      expect(harness.state.desiredRevision).toBe('8');
    },
  );

  it('finalizes deletion only with confirmed router, route, Keeper, helper, and endpoint absence', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/reported';
    harness.mapping.desiredPresence = 'absent';
    harness.mapping.desiredRevision = '8';
    harness.mapping.keeperDesiredEnabled = false;
    harness.mapping.syncStatus = 'deleting';
    harness.state.desiredRevision = '8';

    await harness.service.consumeMessage(
      topic,
      reported(harness, 8, {
        currentEndpoint: undefined,
        desiredState: 'absent',
        keeperDesiredEnabled: false,
        keeperStatus: 'disabled',
        routePresent: false,
        routerPresent: true,
        syncStatus: 'deleting',
      }),
    );
    expect(harness.mapping.isDeleted).toBe(false);
    expect(harness.mapping.activeKey).toBe('udp:9000');

    await harness.service.consumeMessage(
      topic,
      reported(harness, 8, {
        currentEndpoint: undefined,
        desiredState: 'absent',
        keeperDesiredEnabled: false,
        keeperStatus: 'disabled',
        routePresent: false,
        routerPresent: false,
      }),
    );
    expect(harness.mapping.isDeleted).toBe(true);
    expect(harness.mapping.activeKey).toBeNull();
    expect(harness.mapping.activeGroupProtocolKey).toBeNull();
    expect(harness.group.isDeleted).toBe(true);
    expect(harness.state.desiredRevision).toBe('9');

    await expect(
      harness.service.consumeMessage(
        topic,
        reported(harness, 8, {
          currentEndpoint: undefined,
          desiredState: 'absent',
          keeperDesiredEnabled: false,
          keeperStatus: 'disabled',
          routePresent: false,
          routerPresent: false,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('appends endpoint events idempotently by event ID', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/events';
    const payload = Buffer.from(
      JSON.stringify({
        agentId: 'nas-main',
        endpoint: {
          observedAt: '2026-07-22T01:02:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45000,
          validUntil: '2026-07-22T01:04:04.000Z',
        },
        eventId: 'event-1',
        mappingId: '100',
        occurredAt: '2026-07-22T01:02:05.000Z',
        revision: 7,
        schemaVersion: 1,
        type: 'published',
      }),
    );

    await harness.service.consumeMessage(topic, payload);
    await harness.service.consumeMessage(topic, payload);
    expect(harness.histories).toHaveLength(1);
    expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
    expect(harness.publishCommitted).toHaveBeenCalledWith('events');
  });

  it('stages one fact for a direct valid port change with the same transaction manager', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    const topic = 'kt/network/v1/agents/nas-main/events';

    await harness.service.consumeMessage(topic, endpointEvent());

    expect(harness.stager.stage).toHaveBeenCalledTimes(1);
    expect(harness.stager.stage).toHaveBeenCalledWith(
      expect.objectContaining({ getRepository: expect.any(Function) }),
      {
        eventId: 'endpoint-event-2',
        occurredAt: '2026-07-22T01:02:05.000Z',
        payload: {
          changedAt: '2026-07-22T01:02:05.000Z',
          currentPort: 38213,
          portForwardId: '100',
          previousPort: 8213,
          publicIpv4: '8.8.4.4',
        },
        resourceKey: '100',
        sourceKey: 'network.stun.mapping-port-changed',
      },
    );
    expect(harness.histories).toHaveLength(2);
    expect(harness.stagedEvents).toHaveLength(1);
    expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    expect(harness.operations).toEqual([
      'transaction:start',
      'stager:accepted',
      'transaction:commit',
      'delivery:wake',
    ]);
  });

  it('wakes accepted work only after commit and never for duplicate or non-port transitions', async () => {
    const accepted = createHarness();
    accepted.histories.push(endpointHistory());
    await accepted.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );
    expect(accepted.operations.indexOf('transaction:commit')).toBeLessThan(
      accepted.operations.indexOf('delivery:wake'),
    );

    const duplicate = createHarness();
    duplicate.histories.push(endpointHistory());
    duplicate.stager.stage.mockImplementationOnce(async () => {
      duplicate.operations.push('stager:duplicate');
      return 'duplicate';
    });
    await duplicate.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );
    expect(duplicate.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();

    const nonPort = createHarness();
    nonPort.histories.push(endpointHistory());
    await nonPort.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent({
        endpoint: {
          observedAt: '2026-07-22T01:02:04.000Z',
          publicIpv4: '8.8.4.4',
          publicPort: 8213,
          validUntil: '2026-07-22T01:04:04.000Z',
        },
      }),
    );
    expect(nonPort.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
  });

  it.each(['published', 'withdrawn', 'restored'])(
    'does not stage a %s endpoint event',
    async (type) => {
      const harness = createHarness();
      harness.histories.push(endpointHistory());

      await harness.service.consumeMessage(
        'kt/network/v1/agents/nas-main/events',
        endpointEvent({ type }),
      );

      expect(harness.stager.stage).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'an IP-only change',
      endpointEvent({
        endpoint: {
          observedAt: '2026-07-22T01:02:04.000Z',
          publicIpv4: '1.1.1.1',
          publicPort: 8213,
          validUntil: '2026-07-22T01:04:04.000Z',
        },
      }),
    ],
    ['a first event', endpointEvent()],
  ])('does not stage %s', async (_name, payload) => {
    const harness = createHarness();
    if (_name === 'an IP-only change')
      harness.histories.push(endpointHistory());

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      payload,
    );

    expect(harness.stager.stage).not.toHaveBeenCalled();
  });

  it('does not stage a changed event after a withdrawn history row or invalid prior port', async () => {
    const topic = 'kt/network/v1/agents/nas-main/events';
    const withdrawn = createHarness();
    withdrawn.histories.push(endpointHistory({ eventType: 'withdrawn' }));
    await withdrawn.service.consumeMessage(topic, endpointEvent());
    expect(withdrawn.stager.stage).not.toHaveBeenCalled();

    const invalidPort = createHarness();
    invalidPort.histories.push(endpointHistory({ publicPort: null }));
    await invalidPort.service.consumeMessage(topic, endpointEvent());
    expect(invalidPort.stager.stage).not.toHaveBeenCalled();
  });

  it('orders prior history by occurredAt then id before deciding the previous port', async () => {
    const harness = createHarness();
    harness.histories.push(
      endpointHistory({
        id: '999',
        occurredAt: new KtDateTime('2026-07-22T01:02:03.000Z'),
        publicPort: 8213,
      }),
      endpointHistory({
        eventId: 'endpoint-event-newer',
        id: '1',
        occurredAt: new KtDateTime('2026-07-22T01:02:04.000Z'),
        publicPort: 45000,
      }),
    );

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.historyFindOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_read' },
      order: { occurredAt: 'DESC', id: 'DESC' },
      where: { mappingId: '100' },
    });
    expect(harness.stagedEvents[0]?.payload).toMatchObject({
      previousPort: 45000,
    });
  });

  it('uses history ID as the deterministic tie-breaker for equal occurrence times', async () => {
    const harness = createHarness();
    const occurredAt = new KtDateTime('2026-07-22T01:02:04.000Z');
    harness.histories.push(
      endpointHistory({ id: '1', occurredAt, publicPort: 8213 }),
      endpointHistory({ id: '2', occurredAt, publicPort: 45000 }),
    );

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.stagedEvents[0]?.payload).toMatchObject({
      previousPort: 45000,
    });
  });

  it('serializes concurrent changes and stages the second transition from the first committed port', async () => {
    const harness = createConcurrentEndpointHarness();
    const topic = 'kt/network/v1/agents/nas-main/events';
    const first = harness.service.consumeMessage(topic, endpointEvent());
    await harness.historyStageEntered;

    const second = harness.service.consumeMessage(
      topic,
      endpointEvent({
        endpoint: {
          observedAt: '2026-07-22T01:02:06.000Z',
          publicIpv4: '8.8.4.4',
          publicPort: 45000,
          validUntil: '2026-07-22T01:04:06.000Z',
        },
        eventId: 'endpoint-event-3',
        occurredAt: '2026-07-22T01:02:07.000Z',
      }),
    );
    await flushPromises();

    expect(harness.stageCalls).toHaveLength(1);
    expect(harness.stagedEvents).toHaveLength(0);
    harness.releaseFirstStage();
    await Promise.all([first, second]);

    expect(harness.histories).toHaveLength(3);
    expect(harness.stagedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: 'endpoint-event-2',
          payload: expect.objectContaining({ previousPort: 8213 }),
        }),
        expect.objectContaining({
          eventId: 'endpoint-event-3',
          payload: expect.objectContaining({ previousPort: 38213 }),
        }),
      ]),
    );
  });

  it('does not save or stage a duplicate endpoint event ID', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory({ eventId: 'endpoint-event-2' }));

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.historySave).not.toHaveBeenCalled();
    expect(harness.stager.stage).not.toHaveBeenCalled();
  });

  it('commits history when the stager reports an outbox duplicate', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    harness.stager.stage.mockResolvedValueOnce('duplicate');

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.histories).toHaveLength(2);
  });

  it('rolls back history and staged events when staging fails', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    harness.stager.stage.mockImplementationOnce(async (_manager, input) => {
      harness.stagedEvents.push(input);
      throw new Error('outbox unavailable');
    });

    await expect(
      harness.service.consumeMessage(
        'kt/network/v1/agents/nas-main/events',
        endpointEvent(),
      ),
    ).rejects.toThrow('outbox unavailable');
    expect(harness.histories).toHaveLength(1);
    expect(harness.stagedEvents).toHaveLength(0);
    expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    expect(harness.operations).toContain('transaction:rollback');
    expect(harness.operations).not.toContain('transaction:commit');
  });

  it('keeps a committed event ACK-successful when the post-commit wake throws synchronously', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    harness.deliveryCoordinator.requestDrain.mockImplementationOnce(() => {
      harness.operations.push('delivery:wake-throw');
      throw new Error('wake failed');
    });
    const loggerWarn = jest
      .spyOn((harness.service as any).logger, 'warn')
      .mockImplementation();
    const callback = jest.fn();

    await (harness.service as any).acknowledgeIncoming(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
      callback,
    );

    expect(harness.histories).toHaveLength(2);
    expect(harness.stagedEvents).toHaveLength(1);
    expect(harness.operations.indexOf('transaction:commit')).toBeLessThan(
      harness.operations.indexOf('delivery:wake-throw'),
    );
    expect(callback).toHaveBeenCalledWith(0);
    expect(loggerWarn).toHaveBeenCalledWith(
      'System message delivery wake failed',
    );
  });

  it('keeps staging failures ACK-negative and never wakes after rollback', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    harness.stager.stage.mockRejectedValueOnce(new Error('outbox unavailable'));
    const callback = jest.fn();

    await (harness.service as any).acknowledgeIncoming(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.any(Error));
    expect(callback.mock.calls[0][0]).toMatchObject({
      message: 'outbox unavailable',
    });
    expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    expect(harness.operations).toContain('transaction:rollback');
  });

  it('leaves no staged event when history persistence fails', async () => {
    const harness = createHarness();
    harness.histories.push(endpointHistory());
    harness.historySave.mockRejectedValueOnce(new Error('history unavailable'));

    await expect(
      harness.service.consumeMessage(
        'kt/network/v1/agents/nas-main/events',
        endpointEvent(),
      ),
    ).rejects.toThrow('history unavailable');
    expect(harness.stagedEvents).toHaveLength(0);
  });

  it('suppresses Admin events for status heartbeat-only timestamp renewal', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/status';
    const status = (observedAt: string, online = true) =>
      Buffer.from(
        JSON.stringify({
          agentId: 'nas-main',
          observedAt,
          online,
          schemaVersion: 1,
          startedAt: '2026-07-22T01:00:00.000Z',
          version: '0.1.0',
        }),
      );

    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:01:00.000Z'),
    );
    harness.publishCommitted.mockClear();
    const savesBeforeHeartbeat = harness.stateSave.mock.calls.length;
    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:02:00.000Z'),
    );

    expect(harness.state.lastHeartbeatAt?.toISOString()).toBe(
      '2026-07-22T01:02:00.000Z',
    );
    expect(harness.stateSave).toHaveBeenCalledTimes(savesBeforeHeartbeat + 1);
    expect(harness.publishCommitted).not.toHaveBeenCalled();
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();

    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:03:00.000Z', false),
    );
    expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
    expect(harness.publishCommitted).toHaveBeenCalledWith('status');
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
  });

  it('requests DDNS reconciliation for IPv6 changes but not identical heartbeats', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/status';
    const status = (observedAt: string, publicIpv6: string) =>
      Buffer.from(
        JSON.stringify({
          agentId: 'nas-main',
          observedAt,
          online: true,
          publicIpv6,
          schemaVersion: 1,
          startedAt: '2026-07-22T01:00:00.000Z',
          version: '0.1.0',
        }),
      );

    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:01:00.000Z', '2409:8a31::1'),
    );
    expect(harness.requestDdnsReconcile).toHaveBeenCalledTimes(1);
    harness.requestDdnsReconcile.mockClear();

    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:02:00.000Z', '2409:8a31::1'),
    );
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();

    await harness.service.consumeMessage(
      topic,
      status('2026-07-22T01:03:00.000Z', '2409:8a31::2'),
    );
    expect(harness.requestDdnsReconcile).toHaveBeenCalledTimes(1);
  });

  it('accepts a same-instance LWT without regressing heartbeat and ignores an old-instance LWT', async () => {
    const harness = createHarness();
    const topic = 'kt/network/v1/agents/nas-main/status';
    harness.state.online = true;
    harness.state.startedAt = new KtDateTime('2026-07-22T01:00:00.000Z');
    harness.state.lastHeartbeatAt = new KtDateTime('2026-07-22T01:10:00.000Z');
    const sameInstanceWill = Buffer.from(
      JSON.stringify({
        agentId: 'nas-main',
        observedAt: '2026-07-22T01:00:00.000Z',
        online: false,
        schemaVersion: 1,
        startedAt: '2026-07-22T01:00:00.000Z',
        version: '0.1.0',
      }),
    );

    await harness.service.consumeMessage(topic, sameInstanceWill);
    expect(harness.state.online).toBe(false);
    expect(harness.state.lastHeartbeatAt?.toISOString()).toBe(
      '2026-07-22T01:10:00.000Z',
    );

    harness.state.online = true;
    harness.state.startedAt = new KtDateTime('2026-07-22T02:00:00.000Z');
    harness.state.lastHeartbeatAt = new KtDateTime('2026-07-22T02:10:00.000Z');
    await harness.service.consumeMessage(topic, sameInstanceWill);
    expect(harness.state.online).toBe(true);
    expect(harness.state.startedAt?.toISOString()).toBe(
      '2026-07-22T02:00:00.000Z',
    );
    expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
    expect(harness.publishCommitted).toHaveBeenCalledWith('status');
  });

  it('ignores late v1 reported state and events after v2 becomes the desired owner', async () => {
    const harness = createHarness();
    harness.state.desiredSchemaVersion = 2;

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/reported',
      reported(harness, 7),
    );
    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.mapping.currentPublicIpv4).toBeNull();
    expect(harness.histories).toHaveLength(0);
    expect(harness.stagedEvents).toHaveLength(0);
    expect(harness.publishCommitted).not.toHaveBeenCalled();
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
  });

  it('uses the durable v2 applied schema watermark to reject late v1 writes', async () => {
    const harness = createHarness();
    harness.state.desiredSchemaVersion = 1;
    harness.state.appliedSchemaVersion = 2;

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/reported',
      reported(harness, 7),
    );
    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.mapping.currentPublicIpv4).toBeNull();
    expect(harness.histories).toHaveLength(0);
    expect(harness.stagedEvents).toHaveLength(0);
    expect(harness.publishCommitted).not.toHaveBeenCalled();
    expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
  });

  it('locks Agent ownership before the v1 event channel row', async () => {
    const harness = createHarness();

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.stateFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(harness.mappingFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(harness.stateFindOne.mock.invocationCallOrder[0]).toBeLessThan(
      harness.mappingFindOne.mock.invocationCallOrder[0],
    );
  });

  describe('MQTT v2 reported endpoint lifecycle', () => {
    it('publishes a direct TCP endpoint only with confirmed NAS reply routing', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: {
            dnatPresent: false,
            routePresent: true,
          },
        }),
      );

      expect(tcp).toMatchObject({
        currentPublicIpv4: '8.8.8.8',
        currentPublicPort: 45101,
        natmapStatus: 'active',
        syncStatus: 'synced',
      });
    });

    it('locks Agent ownership and every v2 reported channel in a stable order', async () => {
      const harness = createV2Harness();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );

      expect(harness.stateFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(harness.mappingFindOne).toHaveBeenCalledTimes(2);
      for (const call of harness.mappingFindOne.mock.calls) {
        expect(call[0]).toEqual(
          expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
        );
      }
      expect(harness.stateFindOne.mock.invocationCallOrder[0]).toBeLessThan(
        harness.mappingFindOne.mock.invocationCallOrder[0],
      );
      expect(
        harness.mappingFindOne.mock.calls.map(([options]) => options.where.id),
      ).toEqual(['101', '102']);
    });

    it('persists an early TCP candidate without publishing it before the static path converges', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: {
            currentEndpoint: undefined,
            dnatPresent: false,
            routerPresent: false,
            syncStatus: 'syncing',
          },
          '102': { currentEndpoint: undefined },
        }),
      );

      expect(tcp).toMatchObject({
        candidatePublicIpv4: '8.8.8.8',
        candidatePublicPort: 45101,
        currentPublicIpv4: null,
        currentPublicPort: null,
        lastObservedIpv4: '8.8.8.8',
        lastObservedPort: 45101,
        natmapStatus: 'active',
        syncStatus: 'syncing',
      });
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });

    it.each([
      ['missing data plane', { dnatPresent: false, routePresent: false }],
      ['ambiguous data plane', { dnatPresent: true, routePresent: true }],
      ['Router', { routerPresent: false }],
      ['sync', { syncStatus: 'failed' }],
      ['generation', { instanceGeneration: undefined }],
      [
        'tuple',
        {
          candidateEndpoint: v2Endpoint('tcp_natmap', {
            publicPort: 45111,
          }),
        },
      ],
    ])(
      'withdraws an existing TCP current endpoint when the %s publication gate fails',
      async (_gate, gateOverride) => {
        const harness = createV2Harness();
        const tcp = harness.channels[0];
        Object.assign(tcp, {
          currentObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          currentPublicIpv4: '1.1.1.1',
          currentPublicPort: 45000,
          currentValidatedAt: new KtDateTime('2099-07-27T00:00:01.000Z'),
          currentValidUntil: new KtDateTime('2099-07-27T00:00:40.000Z'),
        });

        await harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/reported',
          v2Reported(harness, {
            [tcp.id]: {
              ...gateOverride,
            },
          }),
        );

        expect(tcp.currentPublicIpv4).toBeNull();
        expect(tcp.currentPublicPort).toBeNull();
        expect(tcp.candidatePublicIpv4).toBe('8.8.8.8');
        expect(tcp.natmapStatus).toBe('active');
        expect(harness.requestDdnsReconcile).toHaveBeenCalledTimes(1);
      },
    );

    it('withdraws a stale lease while retaining the latest candidate observation', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:01:00.000Z' }),
      );

      expect(tcp.currentPublicIpv4).toBeNull();
      expect(tcp.currentPublicPort).toBeNull();
      expect(tcp.candidatePublicIpv4).toBe('8.8.8.8');
      expect(tcp.lastObservedIpv4).toBe('8.8.8.8');
      expect(tcp.lastPublishedPublicIpv4).toBe('8.8.8.8');
      expect(tcp.lastPublishedPublicPort).toBe(45101);
      expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
      expect(harness.requestDdnsReconcile).toHaveBeenCalledTimes(1);
    });

    it('isolates a TCP channel digest conflict and still applies a valid UDP sibling', async () => {
      const harness = createV2Harness();
      const [tcp, udp] = harness.channels;

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: { appliedDesiredDigest: 'f'.repeat(64) },
        }),
      );

      expect(tcp).toMatchObject({
        currentPublicIpv4: null,
        lastErrorCode: 'desired_digest_conflict',
        syncStatus: 'conflict',
      });
      expect(udp).toMatchObject({
        currentPublicIpv4: '8.8.4.4',
        currentPublicPort: 45102,
        keeperStatus: 'active',
        syncStatus: 'synced',
      });
      expect(harness.state.appliedRevision).toBe('7');
      expect(harness.state.appliedSchemaVersion).toBe(2);
      expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
      expect(harness.operations.indexOf('transaction:commit')).toBeLessThan(
        harness.operations.indexOf('sse'),
      );
      expect(harness.operations.indexOf('transaction:commit')).toBeLessThan(
        harness.operations.indexOf('ddns:wake'),
      );
    });

    it('persists static, Keeper, and NATMap errors in independent fields', async () => {
      const harness = createV2Harness();
      const [tcp, udp] = harness.channels;

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: {
            errorCode: 'tcp_static_failed',
            errorMessage: 'TCP static path failed',
            natmapErrorCode: 'natmap_callback_stale',
            natmapErrorMessage: 'NATMap callback is stale',
            natmapStatus: 'failed',
            syncStatus: 'failed',
          },
          [udp.id]: {
            errorCode: 'udp_static_failed',
            errorMessage: 'UDP static path failed',
            keeperErrorCode: 'stun_probe_failed',
            keeperErrorMessage: 'STUN probe failed',
            keeperStatus: 'failed',
            syncStatus: 'failed',
          },
        }),
      );

      expect(tcp).toMatchObject({
        lastErrorCode: 'tcp_static_failed',
        lastErrorMessage: 'TCP static path failed',
        natmapLastErrorCode: 'natmap_callback_stale',
        natmapLastErrorMessage: 'NATMap callback is stale',
      });
      expect(udp).toMatchObject({
        keeperLastErrorCode: 'stun_probe_failed',
        keeperLastErrorMessage: 'STUN probe failed',
        lastErrorCode: 'udp_static_failed',
        lastErrorMessage: 'UDP static path failed',
      });
    });

    it('rejects a wrong outer snapshot digest without mutating either channel', async () => {
      const harness = createV2Harness();

      await expect(
        harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/reported',
          v2Reported(harness, {}, { snapshotDigest: 'f'.repeat(64) }),
        ),
      ).rejects.toThrow('snapshot digest');

      expect(harness.channels[0].currentPublicIpv4).toBeNull();
      expect(harness.channels[1].currentPublicIpv4).toBeNull();
      expect(harness.state.appliedRevision).toBe('0');
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });

    it('does not let an older validation replace a newer current tuple', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();
      const olderEvidence = v2Endpoint('tcp_natmap', {
        observedAt: '2099-07-26T23:59:59.000Z',
        publicIpv4: '1.1.1.1',
        publicPort: 45111,
        validatedAt: '2099-07-27T00:00:04.000Z',
        validUntil: '2099-07-27T00:01:00.000Z',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            [tcp.id]: {
              candidateEndpoint: olderEvidence,
              currentEndpoint: olderEvidence,
              lastObservedEndpoint: olderEvidence,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(tcp.currentPublicIpv4).toBe('8.8.8.8');
      expect(tcp.currentPublicPort).toBe(45101);
      expect(tcp.currentValidatedAt?.toISOString()).toBe(
        '2099-07-27T00:00:05.000Z',
      );
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });

    it('ignores an older same-revision report instead of regressing candidate and runtime state', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:30.000Z' }),
      );
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            [tcp.id]: {
              candidateEndpoint: undefined,
              currentEndpoint: undefined,
              errorCode: 'old_failure',
              errorMessage: 'stale report',
              lastObservedEndpoint: undefined,
              natmapStatus: 'failed',
              syncStatus: 'failed',
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(tcp).toMatchObject({
        candidatePublicIpv4: '8.8.8.8',
        candidatePublicPort: 45101,
        currentPublicIpv4: '8.8.8.8',
        currentPublicPort: 45101,
        lastErrorCode: null,
        natmapStatus: 'active',
        syncStatus: 'synced',
      });
      expect((tcp as any).lastReportedAt?.toISOString()).toBe(
        '2099-07-27T00:00:30.000Z',
      );
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });

    it('uses the raw RFC3339Nano waterline for same-millisecond reports', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:30.000900Z' }),
      );
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            [tcp.id]: {
              candidateEndpoint: undefined,
              currentEndpoint: undefined,
              errorCode: 'old_failure',
              errorMessage: 'stale report',
              lastObservedEndpoint: undefined,
              natmapStatus: 'failed',
              syncStatus: 'failed',
            },
          },
          { reportedAt: '2099-07-27T00:00:30.000100Z' },
        ),
      );

      expect(tcp).toMatchObject({
        currentPublicIpv4: '8.8.8.8',
        currentPublicPort: 45101,
        lastErrorCode: null,
        lastReportedAtWire: '2099-07-27T00:00:30.000900Z',
        natmapStatus: 'active',
        syncStatus: 'synced',
      });
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });

    it('does not apply an old revision report waterline to a newer snapshot revision', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:30.000Z' }),
      );
      harness.state.desiredRevision = '8';
      harness.state.desiredIssuedAt = new KtDateTime(
        '2099-07-27T00:00:31.000Z',
      );
      for (const channel of harness.channels) {
        channel.desiredRevision = '8';
        channel.desiredIssuedAt = harness.state.desiredIssuedAt;
      }
      const nextEndpoint = v2Endpoint('tcp_natmap', {
        publicPort: 45111,
        validatedAt: '2099-07-27T00:00:06.000Z',
        validUntil: '2099-07-27T00:01:00.000Z',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            [tcp.id]: {
              candidateEndpoint: nextEndpoint,
              currentEndpoint: nextEndpoint,
              lastObservedEndpoint: nextEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:10.000Z' },
        ),
      );

      expect(harness.state.appliedRevision).toBe('8');
      expect(tcp).toMatchObject({
        currentPublicPort: 45111,
        lastReportedAtWire: '2099-07-27T00:00:10.000Z',
        reportedRevision: '8',
        syncStatus: 'synced',
      });
    });

    it('soft-deletes a logical group only after every protocol channel confirms absence', async () => {
      const harness = createV2Harness();
      const [tcp, udp] = harness.channels;
      Object.assign(tcp, {
        desiredPresence: 'absent',
        natmapDesiredEnabled: false,
      });
      Object.assign(udp, {
        desiredPresence: 'absent',
        keeperDesiredEnabled: false,
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [udp.id]: {
            routePresent: true,
            routerPresent: true,
            syncStatus: 'deleting',
          },
        }),
      );

      expect(tcp.isDeleted).toBe(true);
      expect(udp.isDeleted).toBe(false);
      expect(harness.groups[0].isDeleted).toBe(false);
      expect(harness.state.desiredRevision).toBe('8');

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );

      expect(udp.isDeleted).toBe(true);
      expect(harness.groups[0].isDeleted).toBe(true);
      expect(harness.state.desiredRevision).toBe('9');
    });

    it('keeps a TCP tombstone until the direct reply route is absent', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      Object.assign(tcp, {
        desiredPresence: 'absent',
        natmapDesiredEnabled: false,
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: { routePresent: true },
        }),
      );

      expect(tcp.isDeleted).toBe(false);

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {
          [tcp.id]: { routePresent: false },
        }),
      );

      expect(tcp.isDeleted).toBe(true);
    });

    it('rolls back v2 report state and emits no post-commit effects when persistence fails', async () => {
      const harness = createV2Harness();
      harness.mappingSave.mockRejectedValueOnce(
        new Error('channel persistence failed'),
      );

      await expect(
        harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/reported',
          v2Reported(harness),
        ),
      ).rejects.toThrow('channel persistence failed');

      expect(harness.channels[0].currentPublicIpv4).toBeNull();
      expect(harness.histories).toHaveLength(0);
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
      expect(harness.operations).toContain('transaction:rollback');
    });

    it('renews validation for the same tuple without history, DDNS, or SSE churn', async () => {
      const harness = createV2Harness();
      const tcp = harness.channels[0];
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      const firstObservedAt = tcp.currentObservedAt?.toISOString();
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();
      const renewed = v2Endpoint('tcp_natmap', {
        observedAt: '2099-07-27T00:00:20.000Z',
        validatedAt: '2099-07-27T00:00:20.000Z',
        validUntil: '2099-07-27T00:01:20.000Z',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            [tcp.id]: {
              candidateEndpoint: renewed,
              currentEndpoint: renewed,
              lastObservedEndpoint: renewed,
            },
          },
          { reportedAt: '2099-07-27T00:00:25.000Z' },
        ),
      );

      expect(tcp.currentObservedAt?.toISOString()).toBe(firstObservedAt);
      expect(tcp.currentValidatedAt?.toISOString()).toBe(
        '2099-07-27T00:00:20.000Z',
      );
      expect(tcp.currentValidUntil?.toISOString()).toBe(
        '2099-07-27T00:01:20.000Z',
      );
      expect(harness.histories).toHaveLength(0);
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
    });
  });

  describe('MQTT v2 endpoint events', () => {
    it('locks Agent ownership before the v2 event channel row', async () => {
      const harness = createV2Harness();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );

      expect(harness.stateFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(harness.mappingFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(harness.stateFindOne.mock.invocationCallOrder[0]).toBeLessThan(
        harness.mappingFindOne.mock.invocationCallOrder[0],
      );
    });

    it('defers a UDP port-change Outbox until the matching report commits', async () => {
      const harness = createV2Harness();
      harness.histories.push(v2EndpointHistory());

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );

      expect(harness.histories).toHaveLength(2);
      expect(harness.histories[1]).toMatchObject({
        endpointValidatedAt: new KtDateTime('2099-07-27T00:00:15.000Z'),
        endpointValidUntil: new KtDateTime('2099-07-27T00:00:55.000Z'),
        sourceRevision: '7',
      });
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();

      const matchingEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: matchingEndpoint,
              lastObservedEndpoint: matchingEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(harness.stagedEvents).toHaveLength(1);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('stages a restored UDP port change against the last valid endpoint after withdrawal', async () => {
      const harness = createV2Harness();
      harness.histories.push(
        v2EndpointHistory(),
        v2EndpointHistory({
          endpointIdentity: null,
          endpointValidatedAt: null,
          endpointValidUntil: null,
          eventId: 'v2-endpoint-withdrawn-1',
          eventType: 'withdrawn',
          id: '2',
          occurredAt: new KtDateTime('2099-07-27T00:00:10.000Z'),
          publicIpv4: null,
          publicPort: null,
        }),
      );

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          eventId: 'v2-endpoint-restored-1',
          type: 'restored',
        }),
      );
      expect(harness.stagedEvents).toHaveLength(0);

      const restoredEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: restoredEndpoint,
              lastObservedEndpoint: restoredEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(harness.stagedEvents).toEqual([
        {
          eventId: 'v2-endpoint-restored-1',
          occurredAt: '2099-07-27T00:00:16.000Z',
          payload: {
            changedAt: '2099-07-27T00:00:16.000Z',
            currentPort: 45103,
            portForwardId: '102',
            previousPort: 45102,
            publicIpv4: '8.8.4.4',
          },
          resourceKey: '102',
          sourceKey: 'network.stun.mapping-port-changed',
        },
      ]);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('stages a report-first restored UDP port change after withdrawal', async () => {
      const harness = createV2Harness();
      harness.histories.push(
        v2EndpointHistory(),
        v2EndpointHistory({
          endpointIdentity: null,
          endpointValidatedAt: null,
          endpointValidUntil: null,
          eventId: 'v2-endpoint-withdrawn-1',
          eventType: 'withdrawn',
          id: '2',
          occurredAt: new KtDateTime('2099-07-27T00:00:10.000Z'),
          publicIpv4: null,
          publicPort: null,
        }),
      );
      const restoredEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: restoredEndpoint,
              lastObservedEndpoint: restoredEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );
      expect(harness.stagedEvents).toHaveLength(0);
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          eventId: 'v2-endpoint-restored-1',
          type: 'restored',
        }),
      );

      expect(harness.stagedEvents[0]).toMatchObject({
        eventId: 'v2-endpoint-restored-1',
        payload: {
          currentPort: 45103,
          previousPort: 45102,
        },
        sourceKey: 'network.stun.mapping-port-changed',
      });
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('keeps a same-port UDP restoration silent after withdrawal', async () => {
      const harness = createV2Harness();
      harness.histories.push(
        v2EndpointHistory({ publicPort: 45103 }),
        v2EndpointHistory({
          endpointIdentity: null,
          endpointValidatedAt: null,
          endpointValidUntil: null,
          eventId: 'v2-endpoint-withdrawn-1',
          eventType: 'withdrawn',
          id: '2',
          occurredAt: new KtDateTime('2099-07-27T00:00:10.000Z'),
          publicIpv4: null,
          publicPort: null,
        }),
      );

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          eventId: 'v2-endpoint-restored-same-port',
          type: 'restored',
        }),
      );
      const restoredEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: restoredEndpoint,
              lastObservedEndpoint: restoredEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('does not stage an old-revision report-first event even when the tuple matches', async () => {
      const harness = createV2Harness();
      harness.histories.push(v2EndpointHistory());
      const matchingEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: matchingEndpoint,
              lastObservedEndpoint: matchingEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );
      harness.state.desiredRevision = '8';
      harness.state.desiredIssuedAt = new KtDateTime(
        '2099-07-27T00:00:21.000Z',
      );
      for (const channel of harness.channels) {
        channel.desiredRevision = '8';
        channel.desiredIssuedAt = harness.state.desiredIssuedAt;
      }
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: matchingEndpoint,
              lastObservedEndpoint: matchingEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:25.000Z' },
        ),
      );
      harness.stagedEvents.splice(0);
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({ revision: 7 }),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('does not stage an old event-first history against a newer revision with the same tuple', async () => {
      const harness = createV2Harness();
      harness.histories.push(v2EndpointHistory());
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );
      harness.state.desiredRevision = '8';
      harness.state.desiredIssuedAt = new KtDateTime(
        '2099-07-27T00:00:17.000Z',
      );
      for (const channel of harness.channels) {
        channel.desiredRevision = '8';
        channel.desiredIssuedAt = harness.state.desiredIssuedAt;
      }
      const matchingEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: matchingEndpoint,
              lastObservedEndpoint: matchingEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('does not stage a report-first event whose lease differs from current', async () => {
      const harness = createV2Harness();
      harness.histories.push(v2EndpointHistory());
      const currentEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:18.000Z',
        validUntil: '2099-07-27T00:00:58.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint,
              lastObservedEndpoint: currentEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('does not correlate leases that differ only below millisecond precision', async () => {
      const harness = createV2Harness();
      const endpoint = v2Endpoint('udp_stun', {
        observedAt: '2099-07-27T00:00:00.000100Z',
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000100Z',
        validUntil: '2099-07-27T00:00:55.000100Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: endpoint,
              lastObservedEndpoint: endpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000100Z' },
        ),
      );
      harness.stagedEvents.splice(0);
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          endpoint: {
            ...endpoint,
            validatedAt: '2099-07-27T00:00:15.000900Z',
          },
        }),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('rolls back matching-report current and Outbox without erasing the previously committed event history', async () => {
      const harness = createV2Harness();
      harness.histories.push(
        Object.assign(new NetworkEndpointHistory(), {
          eventId: 'v2-endpoint-event-1',
          eventType: 'published',
          firstObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          id: '1',
          lastObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          mappingId: '102',
          mechanism: 'udp_stun',
          occurredAt: new KtDateTime('2099-07-27T00:00:01.000Z'),
          publicIpv4: '8.8.4.4',
          publicPort: 45102,
        }),
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );
      harness.publishCommitted.mockClear();
      harness.requestDdnsReconcile.mockClear();
      harness.deliveryCoordinator.requestDrain.mockClear();
      harness.operations.splice(0);
      harness.mappingSave
        .mockImplementationOnce(async (value) => value)
        .mockRejectedValueOnce(new Error('UDP channel persistence failed'));
      const matchingEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });

      await expect(
        harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/reported',
          v2Reported(
            harness,
            {
              '102': {
                currentEndpoint: matchingEndpoint,
                lastObservedEndpoint: matchingEndpoint,
              },
            },
            { reportedAt: '2099-07-27T00:00:20.000Z' },
          ),
        ),
      ).rejects.toThrow('UDP channel persistence failed');

      expect(harness.channels[1].currentPublicIpv4).toBeNull();
      expect(harness.histories).toHaveLength(2);
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
      expect(harness.operations).toContain('transaction:rollback');
      expect(harness.operations).not.toContain('transaction:commit');
    });

    it('stages a report-first UDP event only after it matches the committed current tuple', async () => {
      const harness = createV2Harness();
      harness.histories.push(
        Object.assign(new NetworkEndpointHistory(), {
          eventId: 'v2-endpoint-event-1',
          eventType: 'published',
          firstObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          id: '1',
          lastObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          mappingId: '102',
          mechanism: 'udp_stun',
          occurredAt: new KtDateTime('2099-07-27T00:00:01.000Z'),
          publicIpv4: '8.8.4.4',
          publicPort: 45102,
        }),
      );
      const matchingEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          harness,
          {
            '102': {
              currentEndpoint: matchingEndpoint,
              lastObservedEndpoint: matchingEndpoint,
            },
          },
          { reportedAt: '2099-07-27T00:00:20.000Z' },
        ),
      );
      expect(harness.stagedEvents).toHaveLength(0);
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent(),
      );

      expect(harness.stagedEvents).toHaveLength(1);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('records TCP NATMap history without using the UDP STUN message source', async () => {
      const harness = createV2Harness();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: v2Endpoint('tcp_natmap'),
          eventId: 'v2-tcp-event-1',
          mechanism: 'tcp_natmap',
          protocol: 'tcp',
        }),
      );

      expect(harness.histories).toHaveLength(1);
      expect(harness.histories[0]).toMatchObject({
        mappingId: '101',
        mechanism: 'tcp_natmap',
      });
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('stages a TCP endpoint-change fact only after the matching report commits', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicIpv4: '8.8.8.7',
        publicPort: 45_100,
      });
      harness.histories.push(
        v2EndpointHistory({
          endpointIdentity: endpointLeaseIdentityV2(previousEndpoint),
          endpointValidatedAt: new KtDateTime(previousEndpoint.validatedAt),
          endpointValidUntil: new KtDateTime(previousEndpoint.validUntil),
          eventId: 'v2-tcp-event-0',
          mappingId: '101',
          mechanism: 'tcp_natmap',
          publicIpv4: previousEndpoint.publicIpv4,
          publicPort: previousEndpoint.publicPort,
        }),
      );
      const currentEndpoint = v2Endpoint('tcp_natmap');
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: currentEndpoint,
          eventId: 'v2-tcp-event-1',
          mechanism: 'tcp_natmap',
          protocol: 'tcp',
        }),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );

      expect(harness.stagedEvents).toEqual([
        {
          eventId: 'v2-tcp-event-1',
          occurredAt: '2099-07-27T00:00:16.000Z',
          payload: {
            previousPublicIpv4: '8.8.8.7',
            previousPublicPort: 45_100,
            publicIpv4: '8.8.8.8',
            publicPort: 45_101,
            tcpChannelId: '101',
          },
          resourceKey: '101',
          sourceKey: 'network.tcp.natmap-endpoint-changed',
        },
      ]);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('stages a report-first TCP event when only the public IPv4 changes', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicIpv4: '8.8.8.7',
      });
      harness.histories.push(
        v2EndpointHistory({
          endpointIdentity: endpointLeaseIdentityV2(previousEndpoint),
          endpointValidatedAt: new KtDateTime(previousEndpoint.validatedAt),
          endpointValidUntil: new KtDateTime(previousEndpoint.validUntil),
          eventId: 'v2-tcp-event-0',
          mappingId: '101',
          mechanism: 'tcp_natmap',
          publicIpv4: previousEndpoint.publicIpv4,
          publicPort: previousEndpoint.publicPort,
        }),
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: v2Endpoint('tcp_natmap'),
          eventId: 'v2-tcp-event-1',
          mechanism: 'tcp_natmap',
          protocol: 'tcp',
        }),
      );

      expect(harness.stagedEvents[0]).toMatchObject({
        payload: {
          previousPublicIpv4: '8.8.8.7',
          previousPublicPort: 45_101,
          publicIpv4: '8.8.8.8',
          publicPort: 45_101,
          tcpChannelId: '101',
        },
        sourceKey: 'network.tcp.natmap-endpoint-changed',
      });
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('stages one event-first restored TCP port change against the last valid endpoint after withdrawal', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicPort: 45_100,
      });
      seedV2TcpWithdrawalHistory(harness, previousEndpoint);
      const restoredEvent = v2EndpointEvent({
        channelId: '101',
        endpoint: v2Endpoint('tcp_natmap'),
        eventId: 'v2-tcp-restored-1',
        mechanism: 'tcp_natmap',
        protocol: 'tcp',
        type: 'restored',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        restoredEvent,
      );
      expect(harness.stagedEvents).toHaveLength(0);

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:20.000Z' }),
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:20.000Z' }),
      );

      expect(harness.stagedEvents).toEqual([
        {
          eventId: 'v2-tcp-restored-1',
          occurredAt: '2099-07-27T00:00:16.000Z',
          payload: {
            previousPublicIpv4: '8.8.8.8',
            previousPublicPort: 45_100,
            publicIpv4: '8.8.8.8',
            publicPort: 45_101,
            tcpChannelId: '101',
          },
          resourceKey: '101',
          sourceKey: 'network.tcp.natmap-endpoint-changed',
        },
      ]);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('stages one report-first restored TCP IPv4 change against the last valid endpoint after withdrawal', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicIpv4: '8.8.8.7',
      });
      seedV2TcpWithdrawalHistory(harness, previousEndpoint);
      const restoredEvent = v2EndpointEvent({
        channelId: '101',
        endpoint: v2Endpoint('tcp_natmap'),
        eventId: 'v2-tcp-restored-1',
        mechanism: 'tcp_natmap',
        protocol: 'tcp',
        type: 'restored',
      });

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      expect(harness.stagedEvents).toHaveLength(0);

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        restoredEvent,
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        restoredEvent,
      );

      expect(harness.stagedEvents).toEqual([
        {
          eventId: 'v2-tcp-restored-1',
          occurredAt: '2099-07-27T00:00:16.000Z',
          payload: {
            previousPublicIpv4: '8.8.8.7',
            previousPublicPort: 45_101,
            publicIpv4: '8.8.8.8',
            publicPort: 45_101,
            tcpChannelId: '101',
          },
          resourceKey: '101',
          sourceKey: 'network.tcp.natmap-endpoint-changed',
        },
      ]);
      expect(harness.deliveryCoordinator.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('keeps a late TCP restored event silent when a newer withdrawal owns the timeline', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicPort: 45_100,
      });
      seedV2TcpWithdrawalHistory(harness, previousEndpoint);
      harness.histories[1].occurredAt = new KtDateTime(
        '2099-07-27T00:00:20.000Z',
      );

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness, {}, { reportedAt: '2099-07-27T00:00:25.000Z' }),
      );
      expect(harness.stagedEvents).toHaveLength(0);

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: v2Endpoint('tcp_natmap'),
          eventId: 'v2-tcp-restored-late',
          mechanism: 'tcp_natmap',
          occurredAt: '2099-07-27T00:00:10.000Z',
          protocol: 'tcp',
          type: 'restored',
        }),
      );

      expect(harness.histories).toHaveLength(3);
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('uses history ID to stage only the latest TCP restored row at the same occurrence time', async () => {
      const currentEndpoint = v2Endpoint('tcp_natmap');
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicPort: 45_100,
      });
      const occurredAt = new KtDateTime('2099-07-27T00:00:20.000Z');
      const latestRestored = createV2Harness();
      seedV2TcpWithdrawalHistory(latestRestored, previousEndpoint);
      latestRestored.histories[1].occurredAt = occurredAt;

      await latestRestored.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          latestRestored,
          {},
          { reportedAt: '2099-07-27T00:00:25.000Z' },
        ),
      );
      expect(latestRestored.stagedEvents).toHaveLength(0);

      await latestRestored.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: currentEndpoint,
          eventId: 'v2-tcp-restored-latest',
          mechanism: 'tcp_natmap',
          occurredAt: '2099-07-27T00:00:20.000Z',
          protocol: 'tcp',
          type: 'restored',
        }),
      );

      expect(latestRestored.stagedEvents).toHaveLength(1);
      expect(latestRestored.stagedEvents[0]?.eventId).toBe(
        'v2-tcp-restored-latest',
      );
      expect(
        latestRestored.deliveryCoordinator.requestDrain,
      ).toHaveBeenCalledTimes(1);

      const olderRestored = createV2Harness();
      seedV2TcpWithdrawalHistory(olderRestored, previousEndpoint);
      olderRestored.histories[1].id = '3';
      olderRestored.histories[1].occurredAt = occurredAt;
      olderRestored.histories.push(
        v2EndpointHistory({
          endpointIdentity: endpointLeaseIdentityV2(currentEndpoint),
          endpointValidatedAt: new KtDateTime(currentEndpoint.validatedAt),
          endpointValidUntil: new KtDateTime(currentEndpoint.validUntil),
          eventId: 'v2-tcp-restored-older',
          eventType: 'restored',
          id: '2',
          mappingId: '101',
          mechanism: 'tcp_natmap',
          occurredAt,
          publicIpv4: currentEndpoint.publicIpv4,
          publicPort: currentEndpoint.publicPort,
        }),
      );

      await olderRestored.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(
          olderRestored,
          {},
          { reportedAt: '2099-07-27T00:00:25.000Z' },
        ),
      );

      expect(olderRestored.stagedEvents).toHaveLength(0);
      expect(
        olderRestored.deliveryCoordinator.requestDrain,
      ).not.toHaveBeenCalled();
    });

    it('keeps a same-tuple TCP restoration silent after withdrawal', async () => {
      const harness = createV2Harness();
      const endpoint = v2Endpoint('tcp_natmap');
      seedV2TcpWithdrawalHistory(harness, endpoint);

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint,
          eventId: 'v2-tcp-restored-same-tuple',
          mechanism: 'tcp_natmap',
          protocol: 'tcp',
          type: 'restored',
        }),
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it('does not stage a TCP restored event without an immediately preceding withdrawal', async () => {
      const harness = createV2Harness();
      const previousEndpoint = v2Endpoint('tcp_natmap', {
        publicIpv4: '8.8.8.7',
        publicPort: 45_100,
      });
      harness.histories.push(
        v2EndpointHistory({
          endpointIdentity: endpointLeaseIdentityV2(previousEndpoint),
          endpointValidatedAt: new KtDateTime(previousEndpoint.validatedAt),
          endpointValidUntil: new KtDateTime(previousEndpoint.validUntil),
          eventId: 'v2-tcp-event-0',
          mappingId: '101',
          mechanism: 'tcp_natmap',
          publicIpv4: previousEndpoint.publicIpv4,
          publicPort: previousEndpoint.publicPort,
        }),
      );
      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/reported',
        v2Reported(harness),
      );
      harness.deliveryCoordinator.requestDrain.mockClear();

      await harness.service.consumeMessage(
        'kt/network/v2/agents/nas-main/events',
        v2EndpointEvent({
          channelId: '101',
          endpoint: v2Endpoint('tcp_natmap'),
          eventId: 'v2-tcp-restored-without-withdrawal',
          mechanism: 'tcp_natmap',
          protocol: 'tcp',
          type: 'restored',
        }),
      );

      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
    });

    it.each(['published', 'withdrawn'] as const)(
      'does not stage a TCP %s lifecycle event',
      async (type) => {
        const harness = createV2Harness();
        const previousEndpoint = v2Endpoint('tcp_natmap', {
          publicIpv4: '8.8.8.7',
          publicPort: 45_100,
        });
        harness.histories.push(
          v2EndpointHistory({
            endpointIdentity: endpointLeaseIdentityV2(previousEndpoint),
            eventId: 'v2-tcp-event-0',
            mappingId: '101',
            mechanism: 'tcp_natmap',
            publicIpv4: previousEndpoint.publicIpv4,
            publicPort: previousEndpoint.publicPort,
          }),
        );
        await harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/reported',
          v2Reported(harness),
        );
        harness.deliveryCoordinator.requestDrain.mockClear();

        await harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/events',
          v2EndpointEvent({
            channelId: '101',
            endpoint:
              type === 'withdrawn' ? undefined : v2Endpoint('tcp_natmap'),
            eventId: `v2-tcp-${type}-1`,
            mechanism: 'tcp_natmap',
            protocol: 'tcp',
            type,
          }),
        );

        expect(harness.stagedEvents).toHaveLength(0);
        expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
      },
    );

    it('rolls back v2 history and Outbox together when staging fails', async () => {
      const harness = createV2Harness();
      const currentEndpoint = v2Endpoint('udp_stun', {
        publicPort: 45103,
        validatedAt: '2099-07-27T00:00:15.000Z',
        validUntil: '2099-07-27T00:00:55.000Z',
      });
      Object.assign(harness.channels[1], {
        currentEndpointIdentity: endpointLeaseIdentityV2(currentEndpoint),
        currentObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
        currentPublicIpv4: '8.8.4.4',
        currentPublicPort: 45103,
        currentValidatedAt: new KtDateTime('2099-07-27T00:00:15.000Z'),
        currentValidatedAtWire: '2099-07-27T00:00:15.000Z',
        currentValidUntil: new KtDateTime('2099-07-27T00:00:55.000Z'),
        reportedRevision: '7',
      });
      harness.histories.push(
        Object.assign(new NetworkEndpointHistory(), {
          eventId: 'v2-endpoint-event-1',
          eventType: 'published',
          firstObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          id: '1',
          lastObservedAt: new KtDateTime('2099-07-27T00:00:00.000Z'),
          mappingId: '102',
          mechanism: 'udp_stun',
          occurredAt: new KtDateTime('2099-07-27T00:00:01.000Z'),
          publicIpv4: '8.8.4.4',
          publicPort: 45102,
        }),
      );
      harness.stager.stage.mockImplementationOnce(async (_manager, input) => {
        harness.stagedEvents.push(input);
        throw new Error('v2 outbox unavailable');
      });

      await expect(
        harness.service.consumeMessage(
          'kt/network/v2/agents/nas-main/events',
          v2EndpointEvent(),
        ),
      ).rejects.toThrow('v2 outbox unavailable');

      expect(harness.histories).toHaveLength(1);
      expect(harness.stagedEvents).toHaveLength(0);
      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.requestDdnsReconcile).not.toHaveBeenCalled();
      expect(harness.deliveryCoordinator.requestDrain).not.toHaveBeenCalled();
      expect(harness.operations).toContain('transaction:rollback');
    });
  });

  it('subscribes to v2 status, persists capability before desired schema activation, and keeps v2 status authoritative', async () => {
    const harness = createHarness();
    (harness.service as any).configService.get = (key: string) =>
      ({
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_AGENT_MQTT_RETRY_MS: '60000',
        NETWORK_AGENT_MQTT_URL: 'mqtt://broker.test:1883',
        NETWORK_TCP_NATMAP_RELEASE_MODE: 'on',
      })[key];
    harness.service.onModuleInit();
    harness.client.emit('connect');
    expect(harness.client.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        'kt/network/v2/agents/nas-main/events': { qos: 1 },
        'kt/network/v2/agents/nas-main/reported': { qos: 1 },
        'kt/network/v2/agents/nas-main/status': { qos: 1 },
      }),
      expect.any(Function),
    );

    await harness.service.consumeMessage(
      'kt/network/v2/agents/nas-main/status',
      v2Status({ online: false }),
    );
    expect(harness.state.maxSupportedSchemaVersion).toBe(2);
    expect(harness.state.tcpNatmapCapable).toBe(true);
    expect(harness.state.desiredSchemaVersion).toBe(2);
    expect(harness.stateSave.mock.calls.length).toBeGreaterThanOrEqual(2);

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/status',
      Buffer.from(
        JSON.stringify({
          agentId: 'nas-main',
          observedAt: '2026-07-26T00:02:00Z',
          online: true,
          schemaVersion: 1,
        }),
      ),
    );
    expect(harness.state.online).toBe(false);
    await harness.service.onModuleDestroy();
  });

  it('clears the old retained owner before v2 publication, commits schema only after PUBACK, and retries toward v2', async () => {
    const harness = createHarness();
    Object.assign(harness.state, {
      desiredSchemaVersion: 2,
      maxSupportedSchemaVersion: 2,
      publishedRevision: '7',
      publishedSchemaVersion: 1,
      tcpNatmapCapable: true,
    });
    Object.assign(harness.mapping, {
      groupId: '1',
      natmapDesiredEnabled: false,
    });
    harness.service.onModuleInit();

    const first = harness.service.publishLatestDesired();
    await flushPromises();
    expect(harness.client.publish).toHaveBeenNthCalledWith(
      1,
      'kt/network/v1/agents/nas-main/desired',
      Buffer.alloc(0),
      { qos: 1, retain: true },
      expect.any(Function),
    );
    harness.publishCallback()(undefined);
    await flushPromises();
    expect(harness.client.publish).toHaveBeenNthCalledWith(
      2,
      'kt/network/v2/agents/nas-main/desired',
      expect.any(Buffer),
      { qos: 1, retain: true },
      expect.any(Function),
    );
    expect(harness.state.publishedSchemaVersion).toBe(1);
    harness.publishCallback()(new Error('PUBACK failed'));
    await expect(first).rejects.toThrow('PUBACK failed');

    const retry = harness.service.publishLatestDesired();
    await flushPromises();
    expect(harness.client.publish).toHaveBeenNthCalledWith(
      3,
      'kt/network/v1/agents/nas-main/desired',
      Buffer.alloc(0),
      { qos: 1, retain: true },
      expect.any(Function),
    );
    harness.publishCallback()(undefined);
    await flushPromises();
    expect(harness.client.publish).toHaveBeenNthCalledWith(
      4,
      'kt/network/v2/agents/nas-main/desired',
      expect.any(Buffer),
      { qos: 1, retain: true },
      expect.any(Function),
    );
    harness.publishCallback()(undefined);
    await expect(retry).resolves.toBe(true);
    expect(harness.state.publishedSchemaVersion).toBe(2);
  });

  it('never performs an API-only downgrade after the Agent may have latched v2 ownership', async () => {
    const accepted = createDowngradeHarness();
    accepted.state.appliedSchemaVersion = 2;

    await expect(accepted.service.requestV2Downgrade()).resolves.toBe(false);

    expect(accepted.state.desiredSchemaVersion).toBe(2);
    expect(accepted.groupFind).not.toHaveBeenCalled();
    expect(accepted.channelFind).not.toHaveBeenCalled();
  });
});

function v2Status(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      agentId: 'nas-main',
      observedAt: '2026-07-26T00:01:10Z',
      online: true,
      schemaVersion: 2,
      supportedSchemaVersions: [1, 2],
      tcpNatmapCapable: true,
      ...overrides,
    }),
  );
}

function createDowngradeHarness(mode = 'off') {
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '7',
    appliedSchemaVersion: 2,
    desiredRevision: '7',
    desiredSchemaVersion: 2,
    publishedRevision: '7',
    publishedSchemaVersion: 2,
  });
  const groups = [
    Object.assign(new NetworkPortForwardGroup(), {
      isDeleted: false,
      protocolMode: 'udp',
    }),
  ];
  const channels = [
    Object.assign(new NetworkPortForward(), {
      desiredPresence: 'present',
      desiredRevision: '7',
      isDeleted: false,
      protocol: 'udp',
      reportedRevision: '7',
      syncStatus: 'synced',
    }),
  ];
  const groupFind = jest.fn(async () => groups);
  const channelFind = jest.fn(async ({ where } = {} as any) =>
    channels.filter((channel) =>
      Object.entries(where || {}).every(
        ([key, value]) => channel[key as keyof NetworkPortForward] === value,
      ),
    ),
  );
  const stateRepository = {
    findOne: async () => state,
    save: jest.fn(async (value) => Object.assign(state, value)),
  };
  const manager = {
    getRepository: (entity) => {
      if (entity === NetworkAgentState) return stateRepository;
      if (entity === NetworkPortForwardGroup) return { find: groupFind };
      if (entity === NetworkPortForward) return { find: channelFind };
      throw new Error('unexpected downgrade repository');
    },
  } as unknown as EntityManager;
  const service = new NetworkAgentMqttService(
    {
      get: (key: string) =>
        ({
          NETWORK_AGENT_ID: 'nas-main',
          NETWORK_TCP_NATMAP_RELEASE_MODE: mode,
        })[key],
    } as ConfigService,
    {
      transaction: async (work) => await work(manager),
    } as unknown as DataSource,
    { publishCommitted: jest.fn() } as never,
    { stage: jest.fn() } as never,
    { requestDrain: jest.fn() } as never,
  );
  return { channelFind, channels, groupFind, groups, service, state };
}
