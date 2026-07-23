import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/network-ddns.entity';
import { NetworkDdnsService } from '../../../src/modules/admin/platform-config/network-management/network-ddns.service';
import {
  NetworkDnsPodClient,
  NetworkDnsPodClientError,
} from '../../../src/modules/admin/platform-config/network-management/network-dnspod.client';
import type { NetworkManagementEventStreamService } from '../../../src/modules/admin/platform-config/network-management/network-management-event-stream.service';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';

type Harness = {
  client: jest.Mocked<Pick<NetworkDnsPodClient, 'getStatus' | 'reconcile'>>;
  mapping: NetworkPortForward;
  recordUpdate: jest.Mock;
  records: NetworkDdnsRecord[];
  service: NetworkDdnsService;
  state: NetworkAgentState;
};

/**
 * Clones one entity to model TypeORM snapshots instead of shared object identity.
 * @param record - In-memory database row.
 * @returns Detached entity snapshot.
 */
function cloneRecord(record: NetworkDdnsRecord): NetworkDdnsRecord {
  return Object.assign(new NetworkDdnsRecord(), record);
}

/**
 * Matches a repository update criterion, including TypeORM's IsNull operator.
 * @param actual - Stored entity field value.
 * @param expected - Plain value or FindOperator-like criterion.
 * @returns True when the in-memory row satisfies the criterion.
 */
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

/** Creates an in-memory repository boundary around the real DDNS service. */
function createHarness(): Harness {
  const records: NetworkDdnsRecord[] = [];
  const mapping = Object.assign(new NetworkPortForward(), {
    currentObservedAt: new KtDateTime('2026-07-23T01:00:00.000Z'),
    currentPublicIpv4: '8.8.8.8',
    currentPublicPort: 45_678,
    currentValidUntil: new KtDateTime('2026-07-23T02:00:00.000Z'),
    desiredPresence: 'present',
    externalPort: 45_678,
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
  const service = new NetworkDdnsService(
    recordRepository,
    mappingRepository,
    stateRepository,
    config,
    client as unknown as NetworkDnsPodClient,
    eventStream,
  );
  return { client, mapping, recordUpdate, records, service, state };
}

/** Creates the fluent list query subset used by the service. */
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

/** Reads a Nest HTTP status from one rejected service operation. */
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
        id: '100',
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
