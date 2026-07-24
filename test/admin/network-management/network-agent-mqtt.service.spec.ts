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
  histories: NetworkEndpointHistory[];
  historyFindOne: jest.Mock;
  historySave: jest.Mock;
  mappingSave: jest.Mock;
  publishCommitted: jest.Mock;
  mapping: NetworkPortForward;
  publishCallback: () => (error?: Error) => void;
  requestDdnsReconcile: jest.Mock;
  service: NetworkAgentMqttService;
  stagedEvents: SystemMessageEventInput[];
  stager: jest.Mocked<SystemMessageEventStager>;
  state: NetworkAgentState;
  stateSave: jest.Mock;
  transactionCalls: () => number;
};

/** Creates a fake MQTT client plus in-memory TypeORM state for bridge tests. */
function createHarness(): MqttHarness {
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    appliedRevision: '0',
    desiredIssuedAt: new KtDateTime('2026-07-22T01:02:03.000Z'),
    desiredRevision: '7',
    online: false,
    publishedRevision: '0',
    targetIpv4: '192.168.31.224',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    activeKey: 'udp:9000',
    currentObservedAt: null,
    currentPublicIpv4: null,
    currentPublicPort: null,
    currentValidUntil: null,
    desiredIssuedAt: state.desiredIssuedAt,
    desiredPresence: 'present',
    desiredRevision: '7',
    externalPort: 9000,
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
  const histories: NetworkEndpointHistory[] = [];
  const stateSave = jest.fn(async (value) => Object.assign(state, value));
  const stateRepository = {
    findOne: async () => state,
    save: stateSave,
  } as unknown as Repository<NetworkAgentState>;
  const mappingSave = jest.fn(async (value) => Object.assign(mapping, value));
  const mappingRepository = {
    find: async () => (mapping.isDeleted ? [] : [mapping]),
    findOne: async ({ where }) => (where.id === mapping.id ? mapping : null),
    save: mappingSave,
  } as unknown as Repository<NetworkPortForward>;
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
        const occurredAt =
          right.occurredAt.getTime() - left.occurredAt.getTime();
        return occurredAt || String(right.id).localeCompare(String(left.id));
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
      if (entity === NetworkEndpointHistory) return historyRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  const stagedEvents: SystemMessageEventInput[] = [];
  const stager = {
    stage: jest.fn(async (_manager, input) => {
      stagedEvents.push(input);
      return 'accepted' as const;
    }),
  } as jest.Mocked<SystemMessageEventStager>;
  let transactionCallCount = 0;
  const dataSource = {
    getRepository: manager.getRepository.bind(manager),
    transaction: async (work) => {
      transactionCallCount += 1;
      const historiesBefore = [...histories];
      const stagedEventsBefore = [...stagedEvents];
      try {
        return await work(manager);
      } catch (error) {
        histories.splice(0, histories.length, ...historiesBefore);
        stagedEvents.splice(0, stagedEvents.length, ...stagedEventsBefore);
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
  const service = new NetworkAgentMqttService(
    configService,
    dataSource,
    eventStream,
    stager,
    factory,
    { requestReconcile: requestDdnsReconcile } as never,
  );
  return {
    client,
    clientOptions: () => options,
    histories,
    historyFindOne,
    historySave,
    mappingSave,
    mapping,
    publishCallback: () => publishAck,
    publishCommitted,
    requestDdnsReconcile,
    service,
    stagedEvents,
    state,
    stateSave,
    stager,
    transactionCalls: () => transactionCallCount,
  };
}

/** Builds one endpoint event payload with a valid STUN endpoint transition shape. */
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

/** Builds a persisted endpoint-history fixture for direct prior-port comparisons. */
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

/** Waits for promise continuations scheduled by the MQTT bridge. */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Mirrors MQTT.js by emitting callback errors through the client error event. */
function createProtocolAck(
  client: MqttClient & EventEmitter,
): jest.Mock<void, [Error | number, number?]> {
  return jest.fn((error: Error | number) => {
    if (error instanceof Error) client.emit('error', error);
  });
}

/** Builds one valid full reported snapshot. */
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

  /** Proves lease renewal is persisted without turning timestamps into page reloads. */
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
      endpointHistory({ id: '2', publicPort: 8213 }),
      endpointHistory({
        eventId: 'endpoint-event-older',
        id: '1',
        publicPort: 38213,
      }),
      endpointHistory({
        eventId: 'endpoint-event-newest',
        id: '3',
        publicPort: 45000,
      }),
    );

    await harness.service.consumeMessage(
      'kt/network/v1/agents/nas-main/events',
      endpointEvent(),
    );

    expect(harness.historyFindOne).toHaveBeenCalledWith({
      order: { id: 'DESC', occurredAt: 'DESC' },
      where: { mappingId: '100' },
    });
    expect(harness.stagedEvents[0]?.payload).toMatchObject({
      previousPort: 45000,
    });
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

  /** Proves liveness persistence does not become a periodic browser refresh. */
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

  /** Proves only public IPv6 semantic changes wake automatic DDNS. */
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
});
