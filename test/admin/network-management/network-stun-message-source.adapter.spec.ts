import type { Repository } from 'typeorm';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/network-ddns.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkStunMessageSourceAdapter } from '../../../src/modules/admin/platform-config/network-management/network-stun-message-source.adapter';
import { SystemMessageSourceRegistry } from '../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';

type Harness = {
  adapter: NetworkStunMessageSourceAdapter;
  ddns: NetworkDdnsRecord;
  ddnsRepository: Repository<NetworkDdnsRecord>;
  mapping: NetworkPortForward;
  mappingRepository: Repository<NetworkPortForward>;
  registry: SystemMessageSourceRegistry;
};

function createHarness(): Harness {
  const mapping = Object.assign(new NetworkPortForward(), {
    currentPublicIpv4: '203.0.113.10',
    currentPublicPort: 38213,
    currentValidUntil: new Date('2026-07-24T13:00:00.000Z'),
    desiredPresence: 'present' as const,
    externalPort: 8213,
    id: '2041700000000000001',
    internalPort: 8213,
    isDeleted: false,
    keeperDesiredEnabled: true,
    name: '帕鲁新世界',
    protocol: 'udp' as const,
  });
  const ddns = Object.assign(new NetworkDdnsRecord(), {
    appliedAddress: '203.0.113.10',
    domain: 'kwitsukasa.top',
    enabled: true,
    id: '2041700000000000002',
    isDeleted: false,
    name: '帕鲁域名',
    portForwardId: mapping.id,
    recordType: 'A' as const,
    sourceType: 'port_forward_ipv4' as const,
    subDomain: 'pal',
    syncStatus: 'synced' as const,
  });
  const mappings = [mapping];
  const records = [ddns];
  const mappingRepository = {
    find: jest.fn(async () => mappings),
    findOne: jest.fn(
      async ({ where }) =>
        mappings.find((item) => item.id === where.id) || null,
    ),
  } as unknown as Repository<NetworkPortForward>;
  const recordRepository = {
    find: jest.fn(async () => records),
    findOne: jest.fn(
      async ({ where }) => records.find((item) => item.id === where.id) || null,
    ),
  } as unknown as Repository<NetworkDdnsRecord>;
  const registry = new SystemMessageSourceRegistry();
  return {
    adapter: new NetworkStunMessageSourceAdapter(
      mappingRepository,
      recordRepository,
      registry,
    ),
    ddns,
    ddnsRepository: recordRepository,
    mapping,
    mappingRepository,
    registry,
  };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    changedAt: '2026-07-24T12:30:00.000Z',
    currentPort: 38213,
    endpoint: 'attacker.example:1',
    portForwardId: '2041700000000000001',
    previousPort: 8213,
    publicIpv4: '203.0.113.10',
    ...overrides,
  };
}

describe('NetworkStunMessageSourceAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers once and only unregisters its own source instance', () => {
    const { adapter, registry } = createHarness();
    adapter.onModuleInit();
    adapter.onModuleInit();
    expect(registry.get(adapter.definition.sourceKey)).toBe(adapter);
    adapter.onModuleDestroy();
    expect(() => registry.get(adapter.definition.sourceKey)).toThrow(
      'unknown_message_source',
    );
  });

  it('accepts only an enabled equal-port UDP Keeper and its linked enabled A record', async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.normalizeSubscriptionConfig({
        ddnsRecordId: '2041700000000000002',
        ignored: 'removed',
        portForwardId: '2041700000000000001',
      }),
    ).resolves.toEqual({
      canonicalConfig: {
        ddnsRecordId: '2041700000000000002',
        portForwardId: '2041700000000000001',
      },
      resourceKey: '2041700000000000001',
      sourceSummary: '帕鲁新世界 · pal.kwitsukasa.top',
    });
  });

  it.each([
    [
      'tcp',
      'mapping_not_udp',
      (harness: Harness) => (harness.mapping.protocol = 'tcp'),
    ],
    [
      'unequal ports',
      'mapping_port_mismatch',
      (harness: Harness) => (harness.mapping.internalPort = 1),
    ],
    [
      'disabled keeper',
      'keeper_disabled',
      (harness: Harness) => (harness.mapping.keeperDesiredEnabled = false),
    ],
    [
      'deleted mapping',
      'mapping_not_managed',
      (harness: Harness) => (harness.mapping.isDeleted = true),
    ],
    [
      'disabled DDNS',
      'ddns_disabled',
      (harness: Harness) => (harness.ddns.enabled = false),
    ],
    [
      'deleted DDNS',
      'ddns_not_found',
      (harness: Harness) => (harness.ddns.isDeleted = true),
    ],
    [
      'non-A DDNS',
      'ddns_not_ipv4',
      (harness: Harness) => (harness.ddns.recordType = 'AAAA'),
    ],
    [
      'non-port-forward DDNS',
      'ddns_not_ipv4',
      (harness: Harness) => (harness.ddns.sourceType = 'agent_ipv6'),
    ],
    [
      'mismatched DDNS mapping',
      'ddns_mapping_mismatch',
      (harness: Harness) =>
        (harness.ddns.portForwardId = '2041700000000000003'),
    ],
  ])(
    'rejects %s subscriptions with the locked %s code',
    async (_name, code, mutate) => {
      const harness = createHarness();
      mutate(harness);
      const config = {
        ddnsRecordId: harness.ddns.id,
        portForwardId: harness.mapping.id,
      };
      await expect(
        harness.adapter.normalizeSubscriptionConfig(config),
      ).rejects.toMatchObject({
        code,
      });
      await expect(
        harness.adapter.inspectSubscription(config),
      ).resolves.toEqual({
        invalidReasonCode: code,
        sourceSummary: '未选择有效的 STUN 映射与 DDNS',
        valid: false,
      });
    },
  );

  it('rejects malformed subscription/event payloads and strips unknown fields', async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.normalizeSubscriptionConfig({
        ddnsRecordId: 2041700000000000002,
        portForwardId: 'not-an-id',
      }),
    ).rejects.toMatchObject({ code: 'invalid_source_config' });
    await expect(
      adapter.inspectSubscription({
        ddnsRecordId: 2041700000000000002,
        portForwardId: 'not-an-id',
      }),
    ).resolves.toEqual({
      invalidReasonCode: 'invalid_source_config',
      sourceSummary: '未选择有效的 STUN 映射与 DDNS',
      valid: false,
    });
    expect(adapter.validateEventPayload(eventPayload())).toEqual({
      changedAt: '2026-07-24T12:30:00.000Z',
      currentPort: 38213,
      portForwardId: '2041700000000000001',
      previousPort: 8213,
      publicIpv4: '203.0.113.10',
    });
    expect(() =>
      adapter.validateEventPayload(eventPayload({ currentPort: '38213' })),
    ).toThrow('invalid_source_config');
    expect(() =>
      adapter.validateEventPayload(eventPayload({ publicIpv4: '2001:db8::1' })),
    ).toThrow('invalid_source_config');
    expect(() => adapter.validateEventPayload(null as never)).toThrow(
      'invalid_source_config',
    );
  });

  it('owns event and subscription resource-key extraction', () => {
    const { adapter } = createHarness();
    const payload = adapter.validateEventPayload(eventPayload());

    expect(adapter.eventResourceKey(payload)).toBe('2041700000000000001');
    expect(
      adapter.subscriptionResourceKey({
        ddnsRecordId: '2041700000000000002',
        portForwardId: '2041700000000000001',
      }),
    ).toBe('2041700000000000001');
    expect(
      adapter.subscriptionResourceKey(
        Object.create({ portForwardId: '2041700000000000001' }),
      ),
    ).toBeNull();
    expect(
      adapter.subscriptionResourceKey({
        portForwardId: 2041700000000000001,
      }),
    ).toBeNull();
  });

  it('maps an absent mapping to the locked subscription and inspection code', async () => {
    const { adapter } = createHarness();
    const config = {
      ddnsRecordId: '2041700000000000002',
      portForwardId: '2041700000000000003',
    };
    await expect(
      adapter.normalizeSubscriptionConfig(config),
    ).rejects.toMatchObject({
      code: 'mapping_not_found',
    });
    await expect(adapter.inspectSubscription(config)).resolves.toEqual({
      invalidReasonCode: 'mapping_not_found',
      sourceSummary: '未选择有效的 STUN 映射与 DDNS',
      valid: false,
    });
  });

  it('maps an absent DDNS record to the locked subscription and inspection code', async () => {
    const { adapter } = createHarness();
    const config = {
      ddnsRecordId: '2041700000000000003',
      portForwardId: '2041700000000000001',
    };
    await expect(
      adapter.normalizeSubscriptionConfig(config),
    ).rejects.toMatchObject({
      code: 'ddns_not_found',
    });
    await expect(adapter.inspectSubscription(config)).resolves.toEqual({
      invalidReasonCode: 'ddns_not_found',
      sourceSummary: '未选择有效的 STUN 映射与 DDNS',
      valid: false,
    });
  });

  it('returns generic options with the temporary legacy STUN fields', async () => {
    const { adapter, mapping } = createHarness();
    mapping.protocol = 'tcp';
    await expect(adapter.listSubscriptionOptions()).resolves.toEqual({
      ddnsRecords: [
        {
          dependsOnValue: mapping.id,
          disabled: true,
          disabledReasonCode: 'UDP_REQUIRED',
          eligible: false,
          fqdn: 'pal.kwitsukasa.top',
          id: '2041700000000000002',
          label: '帕鲁域名 · pal.kwitsukasa.top · UDP_REQUIRED',
          name: '帕鲁域名',
          portForwardId: mapping.id,
          value: '2041700000000000002',
        },
      ],
      portForwards: [
        {
          disabled: true,
          disabledReasonCode: 'UDP_REQUIRED',
          eligible: false,
          externalPort: 8213,
          id: mapping.id,
          internalPort: 8213,
          label: '帕鲁新世界 · TCP:8213 · UDP_REQUIRED',
          name: '帕鲁新世界',
          protocol: 'tcp',
          value: mapping.id,
        },
      ],
    });
  });

  it.each([
    ['invalid month', '2026-13-01T12:00:00Z'],
    ['non-leap-day', '2026-02-29T12:00:00Z'],
    ['invalid February day', '2026-02-30T12:00:00Z'],
    ['invalid offset', '2026-02-28T12:00:00+24:00'],
  ])('rejects an RFC3339 timestamp with %s', (_name, changedAt) => {
    const { adapter } = createHarness();
    expect(() =>
      adapter.validateEventPayload(eventPayload({ changedAt })),
    ).toThrow('invalid_source_config');
  });

  it('normalizes a leap-day RFC3339 timestamp with an offset', () => {
    const { adapter } = createHarness();
    expect(
      adapter.validateEventPayload(
        eventPayload({ changedAt: '2024-02-29T23:59:59.123+08:00' }),
      ),
    ).toMatchObject({ changedAt: '2024-02-29T15:59:59.123Z' });
  });

  it('returns ready variables derived from the server-owned DDNS FQDN and Shanghai time', async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: {
          ddnsRecordId: '2041700000000000002',
          portForwardId: '2041700000000000001',
        },
      }),
    ).resolves.toEqual({
      reasonCode: null,
      status: 'ready',
      variables: {
        changedAt: '2026-07-24 20:30:00',
        domain: 'pal.kwitsukasa.top',
        endpoint: 'pal.kwitsukasa.top:38213',
        mappingName: '帕鲁新世界',
        port: 38213,
        previousPort: 8213,
        publicIpv4: '203.0.113.10',
      },
    });
  });

  it('waits for DDNS, supersedes replaced or expired endpoints, and cancels a changed relationship', async () => {
    const waiting = createHarness();
    waiting.ddns.appliedAddress = null;
    await expect(
      waiting.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: {
          ddnsRecordId: waiting.ddns.id,
          portForwardId: waiting.mapping.id,
        },
      }),
    ).resolves.toMatchObject({
      reasonCode: 'ddns_not_synced',
      status: 'waiting_ddns',
    });

    const superseded = createHarness();
    superseded.mapping.currentPublicPort = 39000;
    await expect(
      superseded.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: {
          ddnsRecordId: superseded.ddns.id,
          portForwardId: superseded.mapping.id,
        },
      }),
    ).resolves.toMatchObject({
      reasonCode: 'endpoint_superseded',
      status: 'superseded',
    });

    const expired = createHarness();
    expired.mapping.currentValidUntil = new Date('2026-07-24T11:59:59.999Z');
    await expect(
      expired.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: {
          ddnsRecordId: expired.ddns.id,
          portForwardId: expired.mapping.id,
        },
      }),
    ).resolves.toEqual({
      reasonCode: 'endpoint_superseded',
      status: 'superseded',
    });

    const cancelled = createHarness();
    cancelled.ddns.enabled = false;
    await expect(
      cancelled.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: {
          ddnsRecordId: cancelled.ddns.id,
          portForwardId: cancelled.mapping.id,
        },
      }),
    ).resolves.toMatchObject({
      reasonCode: 'ddns_disabled',
      status: 'cancelled',
    });
  });

  it('cancels event mapping identity mismatches with invalid_source_config', async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.resolveDelivery({
        eventPayload: eventPayload({ portForwardId: '2041700000000000003' }),
        subscriptionConfig: {
          ddnsRecordId: '2041700000000000002',
          portForwardId: '2041700000000000001',
        },
      }),
    ).resolves.toEqual({
      reasonCode: 'invalid_source_config',
      status: 'cancelled',
    });
  });

  it('cancels malformed event payloads with invalid_source_config', async () => {
    const { adapter } = createHarness();
    await expect(
      adapter.resolveDelivery({
        eventPayload: eventPayload({ currentPort: '38213' }),
        subscriptionConfig: {
          ddnsRecordId: '2041700000000000002',
          portForwardId: '2041700000000000001',
        },
      }),
    ).resolves.toEqual({
      reasonCode: 'invalid_source_config',
      status: 'cancelled',
    });
  });

  it.each([
    ['mapping', 'mappingRepository'],
    ['DDNS', 'ddnsRepository'],
  ] as const)(
    'rethrows an unexpected %s repository error for delivery retry',
    async (_name, repository) => {
      const harness = createHarness();
      const failure = new Error(`${repository} unavailable`);
      jest.spyOn(harness[repository], 'findOne').mockRejectedValueOnce(failure);
      await expect(
        harness.adapter.resolveDelivery({
          eventPayload: eventPayload(),
          subscriptionConfig: {
            ddnsRecordId: harness.ddns.id,
            portForwardId: harness.mapping.id,
          },
        }),
      ).rejects.toBe(failure);
    },
  );
});
