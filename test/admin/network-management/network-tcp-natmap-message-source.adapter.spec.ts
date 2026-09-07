import { Test } from '@nestjs/testing';
import { MessageManagementController } from '../../../src/modules/message-management/contract/message-management.controller';
import { MessageSubscriptionService } from '../../../src/modules/message-management/application/message-subscription.service';
import { MessageTemplateService } from '../../../src/modules/message-management/application/message-template.service';
import { MessageSubscriberRegistry } from '../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MessageManagementPermissionGuard } from '../../../src/modules/message-management/contract/message-management-permission.guard';
import type { Repository } from 'typeorm';
import { KtDateTime } from '../../../src/common';
import { NetworkDdnsRecord } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkTcpNatmapMessageSourceAdapter } from '../../../src/modules/admin/platform-config/network-management/infrastructure/integration/network-tcp-natmap-message-source.adapter';
import { SystemMessageSourceRegistry } from '../../../src/modules/message-management/application/system-message-source.registry';

type Harness = {
  adapter: NetworkTcpNatmapMessageSourceAdapter;
  ddns: NetworkDdnsRecord;
  group: NetworkPortForwardGroup;
  mapping: NetworkPortForward;
  registry: SystemMessageSourceRegistry;
};

function createHarness(): Harness {
  const group = Object.assign(new NetworkPortForwardGroup(), {
    id: '2041700000000000001',
    isDeleted: false,
    name: '帕鲁新世界',
  });
  const mapping = Object.assign(new NetworkPortForward(), {
    currentPublicIpv4: '203.0.113.10',
    currentPublicPort: 38213,
    currentValidUntil: new KtDateTime('2026-07-27T13:00:00.000Z'),
    desiredPresence: 'present' as const,
    groupId: group.id,
    id: '2041700000000000002',
    isDeleted: false,
    natmapDesiredEnabled: true,
    name: group.name,
    protocol: 'tcp' as const,
  });
  const ddns = Object.assign(new NetworkDdnsRecord(), {
    appliedAddress: '203.0.113.10',
    domain: 'kwitsukasa.top',
    enabled: true,
    id: '2041700000000000003',
    isDeleted: false,
    name: '帕鲁 TCP 域名',
    portForwardId: mapping.id,
    recordType: 'A' as const,
    sourceType: 'port_forward_ipv4' as const,
    subDomain: 'pal',
    syncStatus: 'synced' as const,
  });
  const groups = [group];
  const mappings = [mapping];
  const records = [ddns];
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
  const ddnsRepository = {
    find: jest.fn(async () => records),
    findOne: jest.fn(
      async ({ where }) => records.find((item) => item.id === where.id) || null,
    ),
  } as unknown as Repository<NetworkDdnsRecord>;
  const registry = new SystemMessageSourceRegistry();
  return {
    adapter: new NetworkTcpNatmapMessageSourceAdapter(
      mappingRepository,
      groupRepository,
      ddnsRepository,
      registry,
    ),
    ddns,
    group,
    mapping,
    registry,
  };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    previousPublicIpv4: '198.51.100.9',
    previousPublicPort: 38111,
    publicIpv4: '203.0.113.10',
    publicPort: 38213,
    tcpChannelId: '2041700000000000002',
    ...overrides,
  };
}

function subscriptionConfig(overrides: Record<string, unknown> = {}) {
  return {
    ddnsRecordId: '2041700000000000003',
    tcpChannelId: '2041700000000000002',
    ...overrides,
  };
}

describe('NetworkTcpNatmapMessageSourceAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers an independent exact source definition', () => {
    const { adapter, registry } = createHarness();
    adapter.onModuleInit();

    expect(registry.get('network.tcp.natmap-endpoint-changed')).toBe(adapter);
    expect(adapter.definition.subscriptionFields.map(({ key }) => key)).toEqual(
      ['tcpChannelId', 'ddnsRecordId'],
    );
    expect(adapter.definition.variables.map(({ key }) => key)).toEqual([
      'endpoint',
      'fqdn',
      'publicIpv4',
      'publicPort',
      'previousPublicIpv4',
      'previousPublicPort',
      'portForwardName',
    ]);
  });

  it('normalizes exactly two same-channel subscription fields', async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.normalizeSubscriptionConfig(subscriptionConfig()),
    ).resolves.toEqual({
      canonicalConfig: subscriptionConfig(),
      resourceKey: '2041700000000000002',
      sourceSummary: '帕鲁新世界 / TCP NATMap · pal.kwitsukasa.top',
    });
    await expect(
      adapter.normalizeSubscriptionConfig(
        subscriptionConfig({ portForwardId: '2041700000000000002' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_source_config' });
  });

  it('exposes dependent TCP channel and same-channel DDNS options', async () => {
    const { adapter } = createHarness();

    await expect(adapter.listSubscriptionOptions()).resolves.toMatchObject({
      ddnsRecords: [
        {
          dependsOnValue: '2041700000000000002',
          disabled: false,
          value: '2041700000000000003',
        },
      ],
      tcpChannels: [
        {
          disabled: false,
          label: '帕鲁新世界 / TCP NATMap',
          value: '2041700000000000002',
        },
      ],
    });
  });

  it('removes deleted, deleting and UDP resources while retaining disabled current TCP', async () => {
    for (const patch of [
      { isDeleted: true },
      { desiredPresence: 'absent' },
      { protocol: 'udp' },
    ]) {
      const h = createHarness();
      Object.assign(h.mapping, patch);
      expect(await h.adapter.listSubscriptionOptions()).toEqual({
        tcpChannels: [],
        ddnsRecords: [],
      });
    }
    const h = createHarness();
    h.ddns.isDeleted = true;
    expect((await h.adapter.listSubscriptionOptions()).ddnsRecords).toEqual([]);
    h.group.isDeleted = true;
    expect((await h.adapter.listSubscriptionOptions()).tcpChannels).toEqual([]);
    h.group.isDeleted = false;
    h.mapping.natmapDesiredEnabled = false;
    expect(
      (await h.adapter.listSubscriptionOptions()).tcpChannels,
    ).toHaveLength(1);
  });

  it('reads current resources again after deletion and recreation', async () => {
    const h = createHarness();
    expect(
      (await h.adapter.listSubscriptionOptions()).tcpChannels[0].value,
    ).toBe(h.mapping.id);
    h.mapping.isDeleted = true;
    expect((await h.adapter.listSubscriptionOptions()).tcpChannels).toEqual([]);
    h.mapping.isDeleted = false;
    h.mapping.id = '2041700000000000042';
    h.ddns.portForwardId = h.mapping.id;
    expect(
      (await h.adapter.listSubscriptionOptions()).tcpChannels[0].value,
    ).toBe(h.mapping.id);
  });

  it('supports same-channel IP4P records and defers notifications until both IP and port match', async () => {
    const h = createHarness();
    Object.assign(h.ddns, {
      recordType: 'AAAA',
      sourceType: 'port_forward_ip4p',
      appliedAddress: '2001:0:0:0:0:9545:cb00:710a',
    });
    expect(
      (await h.adapter.listSubscriptionOptions()).ddnsRecords[0].disabled,
    ).toBe(false);
    const input = {
      eventPayload: eventPayload(),
      subscriptionConfig: subscriptionConfig(),
    };
    expect((await h.adapter.resolveDelivery(input)).status).toBe('ready');
    h.ddns.appliedAddress = '2001::9546:cb00:710a';
    expect((await h.adapter.resolveDelivery(input)).reasonCode).toBe(
      'ddns_not_synced',
    );
    h.ddns.sourceType = 'agent_ipv6';
    expect((await h.adapter.listSubscriptionOptions()).ddnsRecords).toEqual([]);
    await expect(
      h.adapter.normalizeSubscriptionConfig(subscriptionConfig()),
    ).rejects.toMatchObject({ code: 'ddns_not_ipv4' });
  });

  it('serves fresh source options through the real local Nest HTTP route', async () => {
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
    await app.listen(0, '127.0.0.1');
    try {
      const url =
        (await app.getUrl()) +
        '/message-management/sources/network.tcp.natmap-endpoint-changed/subscription-options';
      const first = await fetch(url);
      expect(first.status).toBe(200);
      expect((await first.json()).data.tcpChannels).toHaveLength(1);
      h.mapping.isDeleted = true;
      const second = await fetch(url);
      expect((await second.json()).data).toEqual({
        tcpChannels: [],
        ddnsRecords: [],
      });
      h.mapping.isDeleted = false;
      h.ddns.recordType = 'AAAA';
      h.ddns.sourceType = 'port_forward_ip4p';
      const third = await fetch(url);
      expect((await third.json()).data.ddnsRecords[0].disabled).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('freezes the exact delivery variables from the event tuple and DDNS FQDN', async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toEqual({
      reasonCode: null,
      status: 'ready',
      variables: {
        endpoint: 'pal.kwitsukasa.top:38213',
        fqdn: 'pal.kwitsukasa.top',
        portForwardName: '帕鲁新世界',
        previousPublicIpv4: '198.51.100.9',
        previousPublicPort: 38111,
        publicIpv4: '203.0.113.10',
        publicPort: 38213,
      },
    });
  });

  it('waits for matching DDNS, supersedes stale tuples, and cancels withdrawal or rebinding', async () => {
    const waiting = createHarness();
    waiting.ddns.appliedAddress = '198.51.100.8';
    await expect(
      waiting.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toMatchObject({
      reasonCode: 'ddns_not_synced',
      status: 'deferred',
    });

    const expired = createHarness();
    expired.mapping.currentValidUntil = new KtDateTime(
      '2026-07-27T11:59:59.999Z',
    );
    await expect(
      expired.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toEqual({
      reasonCode: 'endpoint_superseded',
      status: 'superseded',
    });

    const superseded = createHarness();
    superseded.mapping.currentPublicPort = 39000;
    await expect(
      superseded.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toEqual({
      reasonCode: 'endpoint_superseded',
      status: 'superseded',
    });

    const withdrawn = createHarness();
    withdrawn.mapping.currentPublicIpv4 = null;
    withdrawn.mapping.currentPublicPort = null;
    await expect(
      withdrawn.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toEqual({
      reasonCode: 'endpoint_withdrawn',
      status: 'cancelled',
    });

    const rebound = createHarness();
    rebound.ddns.portForwardId = '2041700000000000009';
    await expect(
      rebound.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toMatchObject({
      reasonCode: 'ddns_mapping_mismatch',
      status: 'cancelled',
    });

    const disabled = createHarness();
    disabled.mapping.natmapDesiredEnabled = false;
    await expect(
      disabled.adapter.resolveDelivery({
        eventPayload: eventPayload(),
        subscriptionConfig: subscriptionConfig(),
      }),
    ).resolves.toEqual({
      reasonCode: 'natmap_disabled',
      status: 'cancelled',
    });
  });

  it('rejects non-changing or malformed event tuples', () => {
    const { adapter } = createHarness();

    expect(() =>
      adapter.validateEventPayload(
        eventPayload({
          previousPublicIpv4: '203.0.113.10',
          previousPublicPort: 38213,
        }),
      ),
    ).toThrow('invalid_source_config');
    expect(() =>
      adapter.validateEventPayload(eventPayload({ publicPort: '38213' })),
    ).toThrow('invalid_source_config');
  });
});
