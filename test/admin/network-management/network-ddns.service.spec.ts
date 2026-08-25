import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkDdnsService } from '../../../src/modules/admin/platform-config/network-management/application/network-ddns.service';
import {
  NetworkDnsPodClient,
  NetworkDnsPodClientError,
} from '../../../src/modules/admin/platform-config/network-management/infrastructure/integration/network-dnspod.client';
import type { NetworkManagementEventStreamService } from '../../../src/modules/admin/platform-config/network-management/application/network-management-event-stream.service';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';

type Harness = {
  client: jest.Mocked<Pick<NetworkDnsPodClient, 'getStatus' | 'reconcile'>>;
  deliveryCoordinator: { notifyDependencyChanged: jest.Mock };
  group: NetworkPortForwardGroup;
  mapping: NetworkPortForward;
  recordUpdate: jest.Mock;
  records: NetworkDdnsRecord[];
  service: NetworkDdnsService;
  state: NetworkAgentState;
};

function cloneRecord(record: NetworkDdnsRecord): NetworkDdnsRecord {
  return Object.assign(new NetworkDdnsRecord(), record);
}

function matchesUpdateCriterion(actual: unknown, expected: unknown): boolean {
  if (
    expected &&
    typeof expected === 'object' &&
    (expected as { _type?: string })._type === 'isNull'
  ) {
    return actual === null || actual === undefined;
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

function createHarness(): Harness {
  const records: NetworkDdnsRecord[] = [];
  const group = Object.assign(new NetworkPortForwardGroup(), {
    externalPort: 45_678,
    id: '10',
    internalPort: 45_678,
    isDeleted: false,
    name: '公网服务',
    protocolMode: 'udp',
    targetIpv4: '192.168.31.224',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    currentObservedAt: new KtDateTime('2026-07-23T01:00:00.000Z'),
    currentPublicIpv4: '8.8.8.8',
    currentPublicPort: 45_678,
    currentValidUntil: new KtDateTime('2026-07-23T02:00:00.000Z'),
    desiredPresence: 'present',
    externalPort: 45_678,
    groupId: group.id,
    id: '100',
    internalPort: 45_678,
    isDeleted: false,
    keeperDesiredEnabled: true,
    name: 'Public UDP',
    protocol: 'udp',
  });
  const state = Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    currentIpv6ObservedAt: new KtDateTime('2026-07-23T01:00:00.000Z'),
    currentPublicIpv6: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
    lastHeartbeatAt: new KtDateTime('2026-07-23T01:00:00.000Z'),
    online: true,
  });
  const recordUpdate = jest.fn(
    async (
      criteria: Record<string, unknown>,
      patch: Partial<NetworkDdnsRecord>,
    ) => {
      const index = records.findIndex((record) =>
        Object.entries(criteria).every(([key, expected]) =>
          matchesUpdateCriterion(
            (record as unknown as Record<string, unknown>)[key],
            expected,
          ),
        ),
      );
      if (index < 0) {
        return { affected: 0, generatedMaps: [], raw: [] };
      }
      records[index] = Object.assign(
        new NetworkDdnsRecord(),
        records[index],
        patch,
      );
      return { affected: 1, generatedMaps: [], raw: [] };
    },
  );
  const recordRepository = {
    count: async () => records.filter((record) => !record.isDeleted).length,
    create: (input) =>
      Object.assign(
        new NetworkDdnsRecord(),
        { id: String(200 + records.length) },
        input,
      ),
    createQueryBuilder: () => createListBuilder(records),
    find: async ({ where } = {} as any) =>
      records
        .filter((record) =>
          Object.entries(where || {}).every(
            ([key, value]) => record[key] === value,
          ),
        )
        .map(cloneRecord),
    findOne: async ({ where }) => {
      const record = records.find((item) =>
        Object.entries(where).every(([key, value]) => item[key] === value),
      );
      return record ? cloneRecord(record) : null;
    },
    save: async (record) => {
      const now = new KtDateTime();
      record.createTime ||= now;
      record.updateTime = now;
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = cloneRecord(record);
      else records.push(cloneRecord(record));
      return record;
    },
    update: recordUpdate,
  } as unknown as Repository<NetworkDdnsRecord>;
  const mappingRepository = {
    find: async () => [mapping],
    findOne: async ({ where }) =>
      where.id === mapping.id && !mapping.isDeleted ? mapping : null,
  } as unknown as Repository<NetworkPortForward>;
  const groupRepository = {
    find: async () => [group],
    findOne: async ({ where }) =>
      where.id === group.id && !group.isDeleted ? group : null,
  } as unknown as Repository<NetworkPortForwardGroup>;
  const stateRepository = {
    findOne: async () => state,
  } as unknown as Repository<NetworkAgentState>;
  const config = {
    get: (key: string) => {
      const values = {
        NETWORK_AGENT_ID: 'nas-main',
        NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS: '60000',
        NETWORK_DDNS_RECONCILE_INTERVAL_MS: '60000',
      };
      return values[key];
    },
  } as ConfigService;
  const client = {
    getStatus: jest.fn(() => ({
      configured: true,
      enabled: true,
      provider: 'dnspod' as const,
    })),
    reconcile: jest.fn(),
  };
  const eventStream = {
    publishCommitted: jest.fn(),
  } as unknown as NetworkManagementEventStreamService;
  const deliveryCoordinator = {
    notifyDependencyChanged: jest.fn().mockResolvedValue(undefined),
    requestDrain: jest.fn(),
  };
  const service = new NetworkDdnsService(
    recordRepository,
    mappingRepository,
    groupRepository,
    stateRepository,
    config,
    client as unknown as NetworkDnsPodClient,
    eventStream,
    deliveryCoordinator,
  );
  return {
    client,
    deliveryCoordinator,
    group,
    mapping,
    recordUpdate,
    records,
    service,
    state,
  };
}

async function prepareEnabledA(harness: Harness): Promise<void> {
  await harness.service.create({
    domain: 'kwitsukasa.top',
    enabled: false,
    name: 'Pal A',
    portForwardId: '100',
    recordType: 'A',
    sourceType: 'port_forward_ipv4',
    subDomain: 'pal',
  });
  harness.records[0].enabled = true;
  harness.records[0].syncStatus = 'pending';
}

function createListBuilder(records: NetworkDdnsRecord[]) {
  const builder = {
    andWhere: () => builder,
    getManyAndCount: async () => [
      records.filter((record) => !record.isDeleted),
      records.filter((record) => !record.isDeleted).length,
    ],
    orderBy: () => builder,
    skip: () => builder,
    take: () => builder,
    where: () => builder,
  };
  return builder;
}

function errorStatus(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 0;
}

describe('NetworkDdnsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-23T01:00:30.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns server-classified IPv4 and Agent IPv6 source options', async () => {
    await expect(
      createHarness().service.sourceOptions({ recordType: 'A' }),
    ).resolves.toEqual([
      expect.objectContaining({
        currentAddress: '8.8.8.8',
        eligible: true,
        groupId: '10',
        id: '100',
        mechanism: 'udp_stun',
        name: '公网服务 / UDP Keeper',
        protocol: 'udp',
        sourceType: 'port_forward_ipv4',
      }),
    ]);
    await expect(
      createHarness().service.sourceOptions({ recordType: 'AAAA' }),
    ).resolves.toEqual([
      expect.objectContaining({
        currentAddress: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
        eligible: true,
        id: 'agent-ipv6',
        sourceType: 'agent_ipv6',
      }),
    ]);
  });

  it('accepts a managed TCP NATMap channel as an IPv4 DDNS source', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.mapping, {
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      protocol: 'tcp',
    });

    await expect(
      harness.service.sourceOptions({ recordType: 'A' }),
    ).resolves.toEqual([
      expect.objectContaining({
        currentAddress: '8.8.8.8',
        eligible: true,
        groupId: '10',
        mechanism: 'tcp_natmap',
        name: '公网服务 / TCP NATMap',
        protocol: 'tcp',
      }),
    ]);
    await expect(
      harness.service.create({
        domain: 'kwitsukasa.top',
        enabled: false,
        name: 'TCP A',
        portForwardId: '100',
        recordType: 'A',
        sourceType: 'port_forward_ipv4',
        subDomain: 'tcp',
      }),
    ).resolves.toMatchObject({
      portForwardId: '100',
      source: expect.objectContaining({ mechanism: 'tcp_natmap' }),
    });
  });

  it('encodes a managed TCP NATMap endpoint as an IP4P AAAA source', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.group, {
      externalPort: 8418,
      internalPort: 2222,
    });
    Object.assign(harness.mapping, {
      currentPublicIpv4: '112.32.126.33',
      currentPublicPort: 51_522,
      externalPort: 8418,
      internalPort: 2222,
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      natmapStatus: 'active',
      protocol: 'tcp',
    });

    await expect(
      harness.service.sourceOptions({ recordType: 'AAAA' }),
    ).resolves.toEqual([
      expect.objectContaining({ sourceType: 'agent_ipv6' }),
      expect.objectContaining({
        currentAddress: '2001::c942:7020:7e21',
        currentPort: 51_522,
        eligible: true,
        id: '100',
        mechanism: 'tcp_natmap',
        name: '公网服务 / TCP NATMap IP4P',
        sourceType: 'port_forward_ip4p',
      }),
    ]);
    await expect(
      harness.service.create({
        domain: 'kwitsukasa.top',
        enabled: false,
        name: 'Gitea SSH IP4P',
        portForwardId: '100',
        recordType: 'AAAA',
        sourceType: 'port_forward_ip4p',
        subDomain: 'git.nas4',
      }),
    ).resolves.toMatchObject({
      portForwardId: '100',
      sourceAddress: null,
      sourceType: 'port_forward_ip4p',
    });
    harness.client.reconcile.mockResolvedValueOnce({
      appliedAddress: '2001::c942:7020:7e21',
      changed: true,
      providerRecordId: '302',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';

    await harness.service.reconcileNow('200', true);

    expect(harness.client.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'AAAA',
        subDomain: 'git.nas4',
        targetAddress: '2001::c942:7020:7e21',
      }),
    );
    expect(harness.records[0]).toMatchObject({
      appliedAddress: '2001::c942:7020:7e21',
      sourceAddress: '2001::c942:7020:7e21',
      syncStatus: 'synced',
    });
  });

  it('derives accessEndpoint from a synchronized A record without writing DNS for a port-only change', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.mapping, {
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      protocol: 'tcp',
    });
    await prepareEnabledA(harness);
    Object.assign(harness.records[0], {
      appliedAddress: '8.8.8.8',
      providerRecordId: '300',
      sourceAddress: '8.8.8.8',
      syncStatus: 'synced',
    });

    await expect(harness.service.list()).resolves.toMatchObject({
      items: [{ accessEndpoint: 'pal.kwitsukasa.top:45678' }],
    });
    harness.mapping.currentPublicPort = 45_679;
    await harness.service.reconcileNow('200');

    expect(harness.client.reconcile).not.toHaveBeenCalled();
    await expect(harness.service.list()).resolves.toMatchObject({
      items: [{ accessEndpoint: 'pal.kwitsukasa.top:45679' }],
    });
  });

  it('reconciles a changed TCP public IPv4 and exposes the endpoint only after provider readback', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.mapping, {
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      protocol: 'tcp',
    });
    harness.client.reconcile.mockResolvedValueOnce({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await prepareEnabledA(harness);
    Object.assign(harness.records[0], {
      appliedAddress: '8.8.8.7',
      providerRecordId: '300',
      sourceAddress: '8.8.8.7',
      syncStatus: 'synced',
    });

    await harness.service.reconcileNow('200');

    expect(harness.client.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ targetAddress: '8.8.8.8' }),
    );
    await expect(harness.service.list()).resolves.toMatchObject({
      items: [
        {
          accessEndpoint: 'pal.kwitsukasa.top:45678',
          appliedAddress: '8.8.8.8',
        },
      ],
    });
  });

  it('withdraws a TCP source to waiting_source without changing NATMap state', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.mapping, {
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      natmapStatus: 'active',
      protocol: 'tcp',
    });
    await prepareEnabledA(harness);
    harness.mapping.currentPublicIpv4 = null;
    harness.mapping.currentPublicPort = null;

    await harness.service.reconcileNow('200', true);

    expect(harness.records[0]).toMatchObject({
      sourceAddress: null,
      syncStatus: 'waiting_source',
    });
    expect(harness.mapping.natmapStatus).toBe('active');
    expect(harness.client.reconcile).not.toHaveBeenCalled();
  });

  it('keeps TCP NATMap runtime state authoritative when DDNS synchronization fails', async () => {
    const harness = createHarness();
    harness.group.protocolMode = 'tcp';
    Object.assign(harness.mapping, {
      keeperDesiredEnabled: false,
      natmapDesiredEnabled: true,
      natmapStatus: 'active',
      protocol: 'tcp',
    });
    harness.client.reconcile.mockRejectedValueOnce(
      new NetworkDnsPodClientError('DNSPOD_RATE_LIMITED', 'rate limited', true),
    );
    await prepareEnabledA(harness);

    await harness.service.reconcileNow('200', true);

    expect(harness.records[0]).toMatchObject({
      lastErrorCode: 'provider_rate_limited',
      syncStatus: 'failed',
    });
    expect(harness.mapping).toMatchObject({
      currentPublicIpv4: '8.8.8.8',
      currentPublicPort: 45_678,
      natmapDesiredEnabled: true,
      natmapStatus: 'active',
    });
  });

  it('never exposes a residual lease from an ineligible IPv4 source', async () => {
    const harness = createHarness();
    harness.mapping.keeperDesiredEnabled = false;

    await expect(
      harness.service.sourceOptions({ recordType: 'A' }),
    ).resolves.toEqual([
      expect.objectContaining({
        currentAddress: null,
        disabledReasonCode: 'KEEPER_DISABLED',
        eligible: false,
        observedAt: null,
        validUntil: null,
      }),
    ]);
  });

  it('normalizes one disabled A binding without exposing provider identity input', async () => {
    const harness = createHarness();

    await expect(
      harness.service.create({
        domain: ' KWITSUKASA.TOP. ',
        enabled: false,
        name: ' Pal A ',
        portForwardId: '100',
        recordType: 'A',
        remark: ' game ',
        sourceType: 'port_forward_ipv4',
        subDomain: ' PAL ',
      }),
    ).resolves.toMatchObject({
      domain: 'kwitsukasa.top',
      enabled: false,
      fqdn: 'pal.kwitsukasa.top',
      name: 'Pal A',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      syncStatus: 'disabled',
    });
    expect(harness.records[0].providerRecordId).toBeNull();
    expect(harness.client.reconcile).not.toHaveBeenCalled();
  });

  it('rejects record/source family mismatches before persistence', async () => {
    const harness = createHarness();

    await harness.service
      .create({
        domain: 'kwitsukasa.top',
        enabled: false,
        name: 'bad',
        portForwardId: '100',
        recordType: 'AAAA',
        sourceType: 'port_forward_ipv4',
        subDomain: 'nas6',
      })
      .catch((error) => expect(errorStatus(error)).toBe(400));

    expect(harness.records).toHaveLength(0);
  });

  it('reconciles A and AAAA addresses without ever using a port', async () => {
    const harness = createHarness();
    harness.client.reconcile
      .mockResolvedValueOnce({
        appliedAddress: '8.8.8.8',
        changed: true,
        providerRecordId: '300',
      })
      .mockResolvedValueOnce({
        appliedAddress: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
        changed: false,
        providerRecordId: '301',
      });
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'NAS AAAA',
      recordType: 'AAAA',
      sourceType: 'agent_ipv6',
      subDomain: 'nas6',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';
    harness.records[1].enabled = true;
    harness.records[1].syncStatus = 'pending';

    await harness.service.reconcileNow(undefined, true);

    expect(harness.client.reconcile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        domain: 'kwitsukasa.top',
        recordType: 'A',
        subDomain: 'pal',
        targetAddress: '8.8.8.8',
      }),
    );
    expect(harness.client.reconcile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        recordType: 'AAAA',
        targetAddress: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
      }),
    );
    expect(JSON.stringify(harness.client.reconcile.mock.calls)).not.toContain(
      '45678',
    );
    expect(harness.records.map((record) => record.syncStatus)).toEqual([
      'synced',
      'synced',
    ]);
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).toHaveBeenCalledTimes(2);
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencyKey: 'network.ddns.synced',
        payload: {
          appliedAddress: '8.8.8.8',
          ddnsRecordId: '200',
        },
      }),
    );
  });

  it('notifies exactly once only after the final guarded synced update commits', async () => {
    const harness = createHarness();
    let providerStarted!: () => void;
    let resolveProvider!: (result: {
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }) => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerResult = new Promise<{
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }>((resolve) => {
      resolveProvider = resolve;
    });
    harness.client.reconcile.mockImplementation(async () => {
      providerStarted();
      return providerResult;
    });
    await prepareEnabledA(harness);

    const reconcile = harness.service.reconcileNow('200', true);
    await started;
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();
    resolveProvider({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await reconcile;
    await Promise.resolve();

    expect(harness.recordUpdate).toHaveBeenCalledTimes(2);
    expect(harness.records[0]).toMatchObject({
      appliedAddress: '8.8.8.8',
      syncStatus: 'synced',
    });
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).toHaveBeenCalledWith({
      dependencyKey: 'network.ddns.synced',
      payload: {
        appliedAddress: '8.8.8.8',
        ddnsRecordId: '200',
      },
    });
    expect(harness.recordUpdate.mock.invocationCallOrder[1]).toBeLessThan(
      harness.deliveryCoordinator.notifyDependencyChanged.mock
        .invocationCallOrder[0],
    );
  });

  it('does not notify when the final guarded synced update affects zero rows', async () => {
    const harness = createHarness();
    const update = harness.recordUpdate.getMockImplementation()!;
    harness.recordUpdate
      .mockImplementationOnce(update)
      .mockResolvedValueOnce({ affected: 0, generatedMaps: [], raw: [] });
    harness.client.reconcile.mockResolvedValue({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await prepareEnabledA(harness);

    await harness.service.reconcileNow('200', true);
    await Promise.resolve();

    expect(harness.recordUpdate).toHaveBeenCalledTimes(2);
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();
    expect(harness.records[0].syncStatus).toBe('syncing');
  });

  it('does not notify on pre-provider stale CAS, provider failure, disabled reread, or synced no-op', async () => {
    const stale = createHarness();
    stale.recordUpdate.mockResolvedValueOnce({
      affected: 0,
      generatedMaps: [],
      raw: [],
    });
    await prepareEnabledA(stale);
    await stale.service.reconcileNow('200', true);
    expect(stale.client.reconcile).not.toHaveBeenCalled();
    expect(
      stale.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();

    const failed = createHarness();
    failed.client.reconcile.mockRejectedValueOnce(
      new NetworkDnsPodClientError('DNSPOD_RATE_LIMITED', 'rate limited', true),
    );
    await prepareEnabledA(failed);
    await failed.service.reconcileNow('200', true);
    expect(
      failed.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();

    const disabled = createHarness();
    let providerStarted!: () => void;
    let resolveProvider!: (result: {
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }) => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    disabled.client.reconcile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
          providerStarted();
        }),
    );
    await prepareEnabledA(disabled);
    const disabledRun = disabled.service.reconcileNow('200', true);
    await started;
    disabled.records[0].enabled = false;
    resolveProvider({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await disabledRun;
    expect(
      disabled.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();

    const synced = createHarness();
    await prepareEnabledA(synced);
    synced.records[0].appliedAddress = '8.8.8.8';
    synced.records[0].providerRecordId = '300';
    synced.records[0].sourceAddress = '8.8.8.8';
    synced.records[0].syncStatus = 'synced';
    await synced.service.reconcileNow('200');
    expect(synced.client.reconcile).not.toHaveBeenCalled();
    expect(
      synced.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();
  });

  it('logs notification rejection without changing authoritative DDNS success', async () => {
    const harness = createHarness();
    const wakeFailure = new Error('wake unavailable');
    harness.deliveryCoordinator.notifyDependencyChanged.mockRejectedValueOnce(
      wakeFailure,
    );
    const loggerWarn = jest
      .spyOn((harness.service as any).logger, 'warn')
      .mockImplementation();
    harness.client.reconcile.mockResolvedValue({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await prepareEnabledA(harness);

    await expect(
      harness.service.reconcileNow('200', true),
    ).resolves.toBeUndefined();
    await Promise.resolve();

    expect(harness.records[0]).toMatchObject({
      appliedAddress: '8.8.8.8',
      providerRecordId: '300',
      syncStatus: 'synced',
    });
    expect(loggerWarn).toHaveBeenCalledWith(
      'System message delivery wake failed after DDNS sync',
    );
  });

  it('waits without calling DNSPod when the IPv6 source is stale', async () => {
    const harness = createHarness();
    harness.state.currentIpv6ObservedAt = new KtDateTime(
      '2026-07-23T00:00:00.000Z',
    );
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'NAS AAAA',
      recordType: 'AAAA',
      sourceType: 'agent_ipv6',
      subDomain: 'nas6',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';

    await harness.service.reconcileNow('200', true);

    expect(harness.records[0]).toMatchObject({
      appliedAddress: null,
      sourceAddress: null,
      syncStatus: 'waiting_source',
    });
    expect(harness.client.reconcile).not.toHaveBeenCalled();
    expect(
      harness.deliveryCoordinator.notifyDependencyChanged,
    ).not.toHaveBeenCalled();
  });

  it('waits without calling the provider when an IPv4 source keeps an ineligible residual lease', async () => {
    const harness = createHarness();
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';
    harness.mapping.keeperDesiredEnabled = false;

    await harness.service.reconcileNow('200', true);

    expect(harness.records[0]).toMatchObject({
      sourceAddress: null,
      syncStatus: 'waiting_source',
    });
    expect(harness.client.reconcile).not.toHaveBeenCalled();
  });

  it('queues a fresh reconcile when the source changes during provider I/O', async () => {
    const harness = createHarness();
    let providerStarted!: () => void;
    let resolveFirst!: (result: {
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }) => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const firstResult = new Promise<{
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    harness.client.reconcile
      .mockImplementationOnce(() => {
        providerStarted();
        return firstResult;
      })
      .mockResolvedValueOnce({
        appliedAddress: '9.9.9.9',
        changed: true,
        providerRecordId: '300',
      });
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';

    const firstReconcile = harness.service.reconcileNow('200', true);
    await started;
    harness.mapping.currentPublicIpv4 = '9.9.9.9';
    resolveFirst({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await firstReconcile;
    await harness.service.reconcileNow('200');

    expect(harness.client.reconcile).toHaveBeenCalledTimes(2);
    expect(harness.client.reconcile.mock.calls.map(([input]) => input)).toEqual(
      [
        expect.objectContaining({ targetAddress: '8.8.8.8' }),
        expect.objectContaining({ targetAddress: '9.9.9.9' }),
      ],
    );
    expect(harness.records[0]).toMatchObject({
      appliedAddress: '9.9.9.9',
      sourceAddress: '9.9.9.9',
      syncStatus: 'synced',
    });
  });

  it('drops a stale CAS write and reconciles only the newly committed DNS identity', async () => {
    const harness = createHarness();
    harness.client.reconcile.mockResolvedValue({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';
    harness.recordUpdate.mockImplementationOnce(async () => {
      harness.records[0].activeKey = 'a:pal2.kwitsukasa.top';
      harness.records[0].subDomain = 'pal2';
      harness.records[0].syncStatus = 'pending';
      harness.records[0].updateTime = new KtDateTime(
        harness.records[0].updateTime.getTime() + 10,
      );
      return { affected: 0, generatedMaps: [], raw: [] };
    });

    await harness.service.reconcileNow('200', true);
    await harness.service.reconcileNow('200');

    expect(harness.client.reconcile).toHaveBeenCalledTimes(1);
    expect(harness.client.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ subDomain: 'pal2' }),
    );
    expect(harness.records[0]).toMatchObject({
      appliedAddress: '8.8.8.8',
      subDomain: 'pal2',
      syncStatus: 'synced',
    });
  });

  it('serializes a concurrent delete behind provider I/O without resurrecting the row', async () => {
    const harness = createHarness();
    let providerStarted!: () => void;
    let resolveProvider!: (result: {
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }) => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerResult = new Promise<{
      appliedAddress: string;
      changed: boolean;
      providerRecordId: string;
    }>((resolve) => {
      resolveProvider = resolve;
    });
    harness.client.reconcile.mockImplementation(() => {
      providerStarted();
      return providerResult;
    });
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';

    const reconcile = harness.service.reconcileNow('200', true);
    await started;
    let deleteSettled = false;
    const remove = harness.service.remove('200').then((result) => {
      deleteSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(deleteSettled).toBe(false);

    resolveProvider({
      appliedAddress: '8.8.8.8',
      changed: true,
      providerRecordId: '300',
    });
    await reconcile;
    await remove;

    expect(harness.records[0]).toMatchObject({
      activeKey: null,
      enabled: false,
      isDeleted: true,
      syncStatus: 'disabled',
    });
    expect(harness.client.reconcile).toHaveBeenCalledTimes(1);
  });

  it('persists a safe bounded retry after a retryable provider failure', async () => {
    const harness = createHarness();
    harness.client.reconcile.mockRejectedValue(
      new NetworkDnsPodClientError(
        'DNSPOD_RATE_LIMITED',
        'DNSPod 请求受限，请稍后重试',
        true,
      ),
    );
    await harness.service.create({
      domain: 'kwitsukasa.top',
      enabled: false,
      name: 'Pal A',
      portForwardId: '100',
      recordType: 'A',
      sourceType: 'port_forward_ipv4',
      subDomain: 'pal',
    });
    harness.records[0].enabled = true;
    harness.records[0].syncStatus = 'pending';

    await harness.service.reconcileNow('200', true);

    expect(harness.records[0]).toMatchObject({
      lastErrorCode: 'provider_rate_limited',
      retryCount: 1,
      sourceAddress: '8.8.8.8',
      syncStatus: 'failed',
    });
    expect(harness.records[0].nextRetryAt).toBeInstanceOf(Date);
    expect(JSON.stringify(harness.records[0])).not.toMatch(
      /secret|credential|raw provider/i,
    );
  });
});
