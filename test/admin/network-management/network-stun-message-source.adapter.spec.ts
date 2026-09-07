import { Test } from '@nestjs/testing';
import { MessageManagementController } from '../../../src/modules/message-management/contract/message-management.controller';
import { MessageSubscriptionService } from '../../../src/modules/message-management/application/message-subscription.service';
import { MessageTemplateService } from '../../../src/modules/message-management/application/message-template.service';
import { MessageSubscriberRegistry } from '../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MessageManagementPermissionGuard } from '../../../src/modules/message-management/contract/message-management-permission.guard';
import type { Repository } from 'typeorm';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkStunMessageSourceAdapter } from '../../../src/modules/admin/platform-config/network-management/infrastructure/integration/network-stun-message-source.adapter';
import { SystemMessageSourceRegistry } from '../../../src/modules/message-management/application/system-message-source.registry';
import { encodeIp4pAddress } from '../../../src/modules/admin/platform-config/network-management/domain/network-ip4p';

type Harness = {
  adapter: NetworkStunMessageSourceAdapter;
  ddns: NetworkDdnsRecord;
  ddnsRepository: Repository<NetworkDdnsRecord>;
  group: NetworkPortForwardGroup;
  groups: NetworkPortForwardGroup[];
  groupRepository: Repository<NetworkPortForwardGroup>;
  mapping: NetworkPortForward;
  mappings: NetworkPortForward[];
  records: NetworkDdnsRecord[];
  mappingRepository: Repository<NetworkPortForward>;
  registry: SystemMessageSourceRegistry;
};

/**
 * 用可变资源集合建立真实适配器，供删除、重建和关联变更的回归测试复用。
 * @returns 适配器、注册表及可独立修改的资源与仓库。
 */
function createHarness(): Harness {
  const group = Object.assign(new NetworkPortForwardGroup(), {
    id: '2041700000000000004',
    isDeleted: false,
    name: '帕鲁新世界',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    currentPublicIpv4: '203.0.113.10',
    currentPublicPort: 38213,
    currentValidUntil: new Date('2026-07-24T13:00:00.000Z'),
    desiredPresence: 'present' as const,
    externalPort: 8213,
    groupId: group.id,
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
  const groups = [group];
  const groupRepository = {
    find: jest.fn(async () => groups),
    findOne: jest.fn(
      async ({ where }) => groups.find((item) => item.id === where.id) || null,
    ),
  } as unknown as Repository<NetworkPortForwardGroup>;
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
      groupRepository,
      recordRepository,
      registry,
    ),
    ddns,
    ddnsRepository: recordRepository,
    group,
    groups,
    groupRepository,
    mapping,
    mappings,
    records,
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

  it('accepts an enabled equal-port UDP Keeper and its linked enabled A record', async () => {
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

  it('accepts WireGuard UDP NATMap independently of Keeper and preserves delivery readiness', async () => {
    const h = createHarness();
    Object.assign(h.mapping, {
      externalPort: 51_825,
      internalPort: 51_820,
      targetIpv4: '192.168.31.81',
      natmapDesiredEnabled: true,
      keeperDesiredEnabled: false,
    });
    const config = { portForwardId: h.mapping.id, ddnsRecordId: h.ddns.id };
    await expect(
      h.adapter.normalizeSubscriptionConfig(config),
    ).resolves.toMatchObject({
      canonicalConfig: config,
    });
    const options = await h.adapter.listSubscriptionOptions();
    expect(options.portForwards[0]).toMatchObject({
      disabled: false,
      disabledReasonCode: null,
    });
    expect(options.ddnsRecords[0]).toMatchObject({
      disabled: false,
      disabledReasonCode: null,
    });
    await expect(
      h.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: config,
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      variables: { endpoint: 'pal.kwitsukasa.top:38213' },
    });
    h.ddns.syncStatus = 'pending';
    await expect(
      h.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: config,
      }),
    ).resolves.toMatchObject({
      status: 'deferred',
      reasonCode: 'ddns_not_synced',
    });
    h.mapping.natmapDesiredEnabled = false;
    h.mapping.keeperDesiredEnabled = true;
    expect(
      (await h.adapter.listSubscriptionOptions()).portForwards[0],
    ).toMatchObject({
      disabled: true,
      disabledReasonCode: 'NATMAP_DISABLED',
    });
    await expect(
      h.adapter.normalizeSubscriptionConfig(config),
    ).rejects.toMatchObject({ code: 'natmap_disabled' });
    await expect(
      h.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: config,
      }),
    ).resolves.toEqual({
      status: 'cancelled',
      reasonCode: 'natmap_disabled',
    });
  });

  it.each(['UDP Keeper', 'UDP NATMap'])(
    'accepts linked IP4P AAAA for %s and waits for both IP and port to synchronize',
    async (mechanism) => {
      const h = createHarness();
      if (mechanism === 'UDP NATMap') {
        Object.assign(h.mapping, {
          externalPort: 51_825,
          internalPort: 51_820,
          targetIpv4: '192.168.31.81',
          natmapDesiredEnabled: true,
          keeperDesiredEnabled: false,
        });
      }
      Object.assign(h.ddns, {
        recordType: 'AAAA',
        sourceType: 'port_forward_ip4p',
        appliedAddress: '2001:0:0:0:0:9545:cb00:710a',
      });
      const config = { portForwardId: h.mapping.id, ddnsRecordId: h.ddns.id };
      await expect(
        h.adapter.normalizeSubscriptionConfig(config),
      ).resolves.toMatchObject({ canonicalConfig: config });
      await expect(
        h.adapter.inspectSubscription(config),
      ).resolves.toMatchObject({ valid: true });
      expect(
        (await h.adapter.listSubscriptionOptions()).ddnsRecords[0],
      ).toMatchObject({ value: h.ddns.id, disabled: false });
      const resolve = () =>
        h.adapter.resolveDelivery({
          eventPayload: eventPayload(),
          subscriptionConfig: config,
        });
      await expect(resolve()).resolves.toMatchObject({
        status: 'ready',
        variables: { endpoint: 'pal.kwitsukasa.top:38213' },
      });
      for (const stale of [
        encodeIp4pAddress('203.0.113.10', 38212),
        encodeIp4pAddress('203.0.113.11', 38213),
        '203.0.113.10',
        'invalid',
        null,
      ]) {
        h.ddns.appliedAddress = stale;
        await expect(resolve()).resolves.toMatchObject({
          status: 'deferred',
          reasonCode: 'ddns_not_synced',
        });
      }
      h.ddns.appliedAddress = '2001::9545:cb00:710a';
      await expect(resolve()).resolves.toMatchObject({ status: 'ready' });
      h.ddns.syncStatus = 'pending';
      await expect(resolve()).resolves.toMatchObject({ status: 'deferred' });
      h.ddns.enabled = false;
      await expect(resolve()).resolves.toMatchObject({
        status: 'cancelled',
        reasonCode: 'ddns_disabled',
      });
      expect(
        (await h.adapter.listSubscriptionOptions()).ddnsRecords[0],
      ).toMatchObject({ disabled: true, disabledReasonCode: 'ddns_disabled' });
      h.ddns.isDeleted = true;
      expect((await h.adapter.listSubscriptionOptions()).ddnsRecords).toEqual(
        [],
      );
    },
  );

  it('does not grant NATMap eligibility to mismatched targets or arbitrary unequal-port UDP mappings', async () => {
    const h = createHarness();
    Object.assign(h.mapping, {
      externalPort: 51_825,
      internalPort: 51_820,
      targetIpv4: '192.168.31.224',
      natmapDesiredEnabled: true,
    });
    expect(
      (await h.adapter.listSubscriptionOptions()).portForwards[0],
    ).toMatchObject({
      disabled: true,
      disabledReasonCode: 'PORT_MISMATCH',
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
      'deleting mapping',
      'mapping_not_managed',
      (harness: Harness) => (harness.mapping.desiredPresence = 'absent'),
    ],
    [
      'deleted group',
      'mapping_not_managed',
      (harness: Harness) => (harness.group.isDeleted = true),
    ],
    [
      'missing group',
      'mapping_not_managed',
      (harness: Harness) => harness.groups.splice(0),
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
      await expect(
        harness.adapter.resolveDelivery({
          eventPayload: eventPayload(),
          subscriptionConfig: config,
        }),
      ).resolves.toEqual({ reasonCode: code, status: 'cancelled' });
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
    await expect(adapter.listSubscriptionOptions()).resolves.toEqual({
      ddnsRecords: [
        {
          dependsOnValue: mapping.id,
          disabled: false,
          disabledReasonCode: null,
          eligible: true,
          fqdn: 'pal.kwitsukasa.top',
          id: '2041700000000000002',
          label: '帕鲁域名 · pal.kwitsukasa.top',
          name: '帕鲁域名',
          portForwardId: mapping.id,
          value: '2041700000000000002',
        },
      ],
      portForwards: [
        {
          disabled: false,
          disabledReasonCode: null,
          eligible: true,
          externalPort: 8213,
          id: mapping.id,
          internalPort: 8213,
          label: '帕鲁新世界 · UDP:8213',
          name: '帕鲁新世界',
          protocol: 'udp',
          value: mapping.id,
        },
      ],
    });
  });

  it.each([
    ['TCP mapping', (h: Harness) => (h.mapping.protocol = 'tcp')],
    ['deleted mapping', (h: Harness) => (h.mapping.isDeleted = true)],
    [
      'deleting mapping',
      (h: Harness) => (h.mapping.desiredPresence = 'absent'),
    ],
    ['deleted group', (h: Harness) => (h.group.isDeleted = true)],
    ['missing group', (h: Harness) => h.groups.splice(0)],
    [
      'unlinked group',
      (h: Harness) => (h.mapping.groupId = '2041700000000000099'),
    ],
  ])('omits %s and its linked DDNS from options', async (_name, mutate) => {
    const h = createHarness();
    mutate(h);
    await expect(h.adapter.listSubscriptionOptions()).resolves.toEqual({
      ddnsRecords: [],
      portForwards: [],
    });
  });

  it.each([
    ['deleted DDNS', (h: Harness) => (h.ddns.isDeleted = true)],
    ['unlinked DDNS', (h: Harness) => (h.ddns.portForwardId = null)],
    [
      'missing mapping',
      (h: Harness) => (h.ddns.portForwardId = '2041700000000000099'),
    ],
    ['AAAA with IPv4 source', (h: Harness) => (h.ddns.recordType = 'AAAA')],
    [
      'A with IP4P source',
      (h: Harness) => (h.ddns.sourceType = 'port_forward_ip4p'),
    ],
    ['agent source', (h: Harness) => (h.ddns.sourceType = 'agent_ipv6')],
  ])(
    'omits %s without removing the current UDP mapping',
    async (_name, mutate) => {
      const h = createHarness();
      mutate(h);
      const options = await h.adapter.listSubscriptionOptions();
      expect(options.ddnsRecords).toEqual([]);
      expect(options.portForwards).toHaveLength(1);
    },
  );

  it.each([
    [
      'KEEPER_DISABLED',
      (h: Harness) => (h.mapping.keeperDesiredEnabled = false),
    ],
    ['PORT_MISMATCH', (h: Harness) => (h.mapping.internalPort = 1)],
  ])('retains current UDP resources with %s', async (reason, mutate) => {
    const h = createHarness();
    mutate(h);
    const options = await h.adapter.listSubscriptionOptions();
    for (const collection of [options.portForwards, options.ddnsRecords]) {
      expect(collection).toHaveLength(1);
      expect(collection[0]).toMatchObject({
        disabled: true,
        disabledReasonCode: reason,
      });
    }
  });

  it('retains a disabled linked A record with its reason', async () => {
    const h = createHarness();
    h.ddns.enabled = false;
    const options = await h.adapter.listSubscriptionOptions();
    expect(options.ddnsRecords).toHaveLength(1);
    expect(options.ddnsRecords[0]).toMatchObject({
      disabled: true,
      disabledReasonCode: 'ddns_disabled',
    });
    expect(options.portForwards[0].disabled).toBe(false);
  });

  it('serves current resources after creation and deletion through the real local Nest HTTP route', async () => {
    jest.useRealTimers();
    const h = createHarness();
    h.adapter.onModuleInit();
    const module = await Test.createTestingModule({
      controllers: [MessageManagementController],
      providers: [
        { provide: SystemMessageSourceRegistry, useValue: h.registry },
        { provide: MessageSubscriberRegistry, useValue: {} },
        { provide: MessageSubscriptionService, useValue: {} },
        { provide: MessageTemplateService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MessageManagementPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const url =
        (await app.getUrl()) +
        '/message-management/sources/network.stun.mapping-port-changed/subscription-options';
      const readOptions = async () => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.code).toBe(200);
        return body.data;
      };
      expect((await readOptions()).portForwards).toHaveLength(1);
      h.group.isDeleted = true;
      expect(await readOptions()).toEqual({
        ddnsRecords: [],
        portForwards: [],
      });
      h.group.isDeleted = false;
      h.mapping.desiredPresence = 'absent';
      expect(await readOptions()).toEqual({
        ddnsRecords: [],
        portForwards: [],
      });
      const addedMapping = Object.assign(new NetworkPortForward(), h.mapping, {
        id: '2041700000000000011',
        desiredPresence: 'present',
        externalPort: 51_825,
        internalPort: 51_820,
        targetIpv4: '192.168.31.81',
        natmapDesiredEnabled: true,
        keeperDesiredEnabled: false,
      });
      const addedRecord = Object.assign(new NetworkDdnsRecord(), h.ddns, {
        id: '2041700000000000012',
        portForwardId: addedMapping.id,
        recordType: 'AAAA',
        sourceType: 'port_forward_ip4p',
      });
      h.mappings.push(addedMapping);
      h.records.push(addedRecord);
      const created = await readOptions();
      expect(created.portForwards[0].disabled).toBe(false);
      expect(created.ddnsRecords[0].disabled).toBe(false);
      expect(
        created.portForwards.map((item: { value: string }) => item.value),
      ).toEqual([addedMapping.id]);
      expect(
        created.ddnsRecords.map((item: { value: string }) => item.value),
      ).toEqual([addedRecord.id]);
      addedRecord.isDeleted = true;
      const deleted = await readOptions();
      expect(deleted.ddnsRecords).toEqual([]);
      expect(deleted.portForwards).toHaveLength(1);
    } finally {
      await app.close();
      h.adapter.onModuleDestroy();
    }
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
      status: 'deferred',
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
    ['group', 'groupRepository'],
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
