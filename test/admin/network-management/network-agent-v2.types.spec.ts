import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NETWORK_AGENT_V2_MAX_MESSAGE_BYTES,
  buildDesiredSnapshotV2,
  canonicalDesiredChannelDigestV2,
  canonicalDesiredSnapshotDigestV2,
  compareNetworkV2Timestamps,
  endpointLeaseIdentityV2,
  parseDesiredSnapshotV2,
  parseEndpointEventV2,
  parseReportedSnapshotV2,
  parseStatusSnapshotV2,
} from '../../../src/modules/admin/platform-config/network-management/contract/network-agent-v2.types';

const rawFixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const fixture = (name: string) => JSON.parse(rawFixture(name)) as any;
const statusValue = () => ({
  agentId: 'nas-main',
  observedAt: '2026-07-26T00:01:10Z',
  online: true,
  schemaVersion: 2,
  supportedSchemaVersions: [1, 2],
  tcpNatmapCapable: true,
});
const eventValue = () => ({
  agentId: 'nas-main',
  channelId: '10',
  eventId: 'event-1',
  groupId: '1',
  mechanism: 'tcp_natmap',
  occurredAt: '2026-07-26T00:01:10Z',
  protocol: 'tcp',
  revision: 7,
  schemaVersion: 2,
  type: 'withdrawn',
});

describe('network agent MQTT v2 contract', () => {
  it('compares RFC3339Nano instants without millisecond truncation', () => {
    expect(
      compareNetworkV2Timestamps(
        '2026-07-27T00:00:00.000900Z',
        '2026-07-27T00:00:00.000100Z',
      ),
    ).toBeGreaterThan(0);
    expect(
      compareNetworkV2Timestamps(
        '2026-07-27T08:00:00.123456789+08:00',
        '2026-07-27T00:00:00.123456789Z',
      ),
    ).toBe(0);
  });

  it('keeps nanosecond-distinct endpoint leases as distinct identities', () => {
    const endpoint = {
      mechanism: 'udp_stun' as const,
      observedAt: '2026-07-27T00:00:00.000100Z',
      publicIpv4: '8.8.8.8',
      publicPort: 8213,
      validatedAt: '2026-07-27T00:00:01.000100Z',
      validUntil: '2026-07-27T00:01:00.000100Z',
    };

    expect(endpointLeaseIdentityV2(endpoint)).not.toBe(
      endpointLeaseIdentityV2({
        ...endpoint,
        validatedAt: '2026-07-27T00:00:01.000900Z',
      }),
    );
  });

  it('parses the shared desired fixture and validates both literal digests', () => {
    const desired = parseDesiredSnapshotV2(
      rawFixture('network-v2-desired.json'),
    );
    expect(canonicalDesiredChannelDigestV2(desired.channels[0])).toBe(
      'b43a0472f2d627b99ee726a31056780892a8aedb8ad477ed4f93fe0f2877a797',
    );
    expect(canonicalDesiredChannelDigestV2(desired.channels[1])).toBe(
      'd0ad7707441ebeddc006f16c7cf9e09466c68f3b2b805782d4130dd4f150eb92',
    );
    expect(canonicalDesiredSnapshotDigestV2(desired)).toBe(
      '5b50e4ed003c10d01ff4876d196470ef2bfe0cf4f4494eb3e6d4700e77726622',
    );
  });

  it.each([
    ['unknown field', (value: any) => (value.extra = true)],
    ['schema/body mismatch', (value: any) => (value.schemaVersion = 1)],
    ['numeric ID drift', (value: any) => (value.channels[0].channelId = 2)],
    [
      'UDP NATMap pair',
      (value: any) => (value.channels[0].natmapDesiredEnabled = true),
    ],
    [
      'TCP Keeper pair',
      (value: any) => (value.channels[1].keeperDesiredEnabled = true),
    ],
  ])('rejects %s before v2 messages reach transport', (_, patch) => {
    const value = fixture('network-v2-desired.json') as any;
    patch(value);
    expect(() => parseDesiredSnapshotV2(JSON.stringify(value))).toThrow();
  });

  it('rejects an independently mutated snapshot digest', () => {
    const value = fixture('network-v2-desired.json');
    value.snapshotDigest = 'f'.repeat(64);
    expect(() => parseDesiredSnapshotV2(JSON.stringify(value))).toThrow();
  });

  it('parses legacy and direct TCP route evidence while rejecting UDP-only fields', () => {
    expect(
      parseReportedSnapshotV2(rawFixture('network-v2-reported.json')),
    ).toMatchObject({ snapshotRevision: 7 });
    const value = fixture('network-v2-reported.json') as any;
    value.channels[0].routePresent = true;
    value.channels[0].dnatPresent = false;
    expect(
      parseReportedSnapshotV2(JSON.stringify(value)).channels[0],
    ).toMatchObject({
      dnatPresent: false,
      protocol: 'tcp',
      routePresent: true,
    });
    value.channels[0].keeperStatus = 'active';
    expect(() => parseReportedSnapshotV2(JSON.stringify(value))).toThrow();
  });

  it('accepts v2 status and matching endpoint events before transport routing', () => {
    expect(parseStatusSnapshotV2(JSON.stringify(statusValue()))).toMatchObject({
      online: true,
    });
    expect(parseEndpointEventV2(JSON.stringify(eventValue()))).toMatchObject({
      type: 'withdrawn',
    });
  });

  it.each([
    [
      'desired',
      parseDesiredSnapshotV2,
      () => rawFixture('network-v2-desired.json'),
    ],
    [
      'reported',
      parseReportedSnapshotV2,
      () => rawFixture('network-v2-reported.json'),
    ],
    ['status', parseStatusSnapshotV2, () => JSON.stringify(statusValue())],
    ['event', parseEndpointEventV2, () => JSON.stringify(eventValue())],
  ])(
    'enforces raw size and trailing JSON for %s',
    (_, parser, validPayload) => {
      expect(parser(validPayload())).toBeDefined();
      expect(() => parser(`${validPayload()}{}`)).toThrow();
      expect(() =>
        parser(Buffer.alloc(NETWORK_AGENT_V2_MAX_MESSAGE_BYTES + 1)),
      ).toThrow();
    },
  );

  it('rejects invalid RFC3339 calendar dates and explicit null optionals', () => {
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({
          ...statusValue(),
          observedAt: '2026-02-29T00:00:00Z',
        }),
      ),
    ).toThrow();
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({ ...statusValue(), version: null }),
      ),
    ).toThrow();
    expect(() =>
      parseEndpointEventV2(JSON.stringify({ ...eventValue(), endpoint: null })),
    ).toThrow();
  });

  it.each(['192.0.0.1', '192.0.2.1', '::ffff:8.8.8.8'])(
    'rejects non-dotted-public IPv4 %s',
    (publicIpv4) => {
      expect(() =>
        parseEndpointEventV2(
          JSON.stringify({
            ...eventValue(),
            endpoint: {
              mechanism: 'tcp_natmap',
              observedAt: '2026-07-26T00:01:00Z',
              publicIpv4,
              publicPort: 443,
              validatedAt: '2026-07-26T00:01:10Z',
              validUntil: '2026-07-26T00:03:00Z',
            },
            type: 'published',
          }),
        ),
      ).toThrow();
    },
  );

  it('accepts 192.0.1.1 outside the reserved /24 ranges', () => {
    expect(
      parseEndpointEventV2(
        JSON.stringify({
          ...eventValue(),
          endpoint: {
            mechanism: 'tcp_natmap',
            observedAt: '2026-07-26T00:01:00Z',
            publicIpv4: '192.0.1.1',
            publicPort: 443,
            validatedAt: '2026-07-26T00:01:10Z',
            validUntil: '2026-07-26T00:03:00Z',
          },
          type: 'published',
        }),
      ),
    ).toMatchObject({ endpoint: { publicIpv4: '192.0.1.1' } });
  });

  it('uses shared UTF-8 byte limits for name, version, and global IPv6', () => {
    const desiredWithName = (name: string) => {
      const value = fixture('network-v2-desired.json');
      value.channels[0].name = name;
      value.channels[0].channelDesiredDigest = canonicalDesiredChannelDigestV2(
        value.channels[0],
      );
      value.snapshotDigest = canonicalDesiredSnapshotDigestV2(value);
      return JSON.stringify(value);
    };
    expect(
      parseDesiredSnapshotV2(desiredWithName('界'.repeat(42))),
    ).toBeDefined();
    expect(() =>
      parseDesiredSnapshotV2(desiredWithName('界'.repeat(43))),
    ).toThrow();
    expect(
      parseStatusSnapshotV2(
        JSON.stringify({
          ...statusValue(),
          publicIpv6: '2409:8A31:05E1:6020:A5EA:838E:843F:BE5E',
          version: '界'.repeat(42),
        }),
      ),
    ).toMatchObject({ publicIpv6: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e' });
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({ ...statusValue(), publicIpv6: 'fd00::1' }),
      ),
    ).toThrow();
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({ ...statusValue(), version: '界'.repeat(43) }),
      ),
    ).toThrow();
  });

  it('builds v2 desired channels with canonical digests and rejects unsafe bigint revisions', () => {
    const state = {
      agentId: 'nas-main',
      desiredIssuedAt: new Date('2026-07-26T00:01:10Z'),
      desiredRevision: '7',
    };
    const channels = [
      {
        desiredPresence: 'present' as const,
        desiredRevision: '7',
        externalPort: 48213,
        groupId: '1',
        id: '10',
        internalPort: 48213,
        keeperDesiredEnabled: false,
        name: 'TCP NATMap',
        natmapDesiredEnabled: true,
        protocol: 'tcp' as const,
        targetIpv4: '192.168.31.224',
      },
    ];
    const desired = buildDesiredSnapshotV2(state, channels);
    expect(desired).toMatchObject({ schemaVersion: 2, snapshotRevision: 7 });
    expect(desired.channels[0].channelDesiredDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(desired.snapshotDigest).toBe(
      canonicalDesiredSnapshotDigestV2(desired),
    );
    expect(() =>
      buildDesiredSnapshotV2(
        { ...state, desiredRevision: '9007199254740992' },
        channels,
      ),
    ).toThrow();
  });

  it('builds and parses a dedicated UDP NATMap channel when bind and target ports differ', () => {
    const state = {
      agentId: 'nas-main',
      desiredIssuedAt: new Date('2026-09-03T00:01:10Z'),
      desiredRevision: '9',
    };
    const desired = buildDesiredSnapshotV2(state, [
      {
        desiredPresence: 'present' as const,
        desiredRevision: '9',
        externalPort: 51825,
        groupId: '3',
        id: '30',
        internalPort: 51820,
        keeperDesiredEnabled: false,
        name: 'WireGuard G2',
        natmapDesiredEnabled: true,
        protocol: 'udp' as const,
        targetIpv4: '192.168.31.81',
      },
    ]);
    expect(desired.channels[0]).toMatchObject({
      natmapDesiredEnabled: true,
      protocol: 'udp',
    });
    expect(desired.channels[0]).not.toHaveProperty('keeperDesiredEnabled');
    expect(parseDesiredSnapshotV2(JSON.stringify(desired))).toEqual(desired);

    const endpoint = {
      mechanism: 'udp_natmap',
      observedAt: '2026-09-03T00:01:00Z',
      publicIpv4: '8.8.8.8',
      publicPort: 52000,
      validatedAt: '2026-09-03T00:01:10Z',
      validUntil: '2026-09-03T00:03:00Z',
    };
    expect(
      parseReportedSnapshotV2(
        JSON.stringify({
          agentId: 'nas-main',
          channels: [
            {
              appliedDesiredDigest: desired.channels[0].channelDesiredDigest,
              appliedDesiredRevision: 9,
              candidateEndpoint: endpoint,
              channelId: '30',
              currentEndpoint: endpoint,
              desiredPresence: 'present',
              groupId: '3',
              instanceGeneration: 'generation-30',
              lastObservedEndpoint: endpoint,
              natmapDesiredEnabled: true,
              natmapStatus: 'active',
              protocol: 'udp',
              routerPresent: false,
              syncStatus: 'synced',
            },
          ],
          reportedAt: '2026-09-03T00:01:10Z',
          schemaVersion: 2,
          snapshotDigest: desired.snapshotDigest,
          snapshotRevision: 9,
        }),
      ).channels[0],
    ).toMatchObject({
      currentEndpoint: { mechanism: 'udp_natmap' },
      natmapStatus: 'active',
      protocol: 'udp',
    });
    expect(
      parseEndpointEventV2(
        JSON.stringify({
          agentId: 'nas-main',
          channelId: '30',
          endpoint,
          eventId: 'event-udp-natmap',
          groupId: '3',
          mechanism: 'udp_natmap',
          occurredAt: '2026-09-03T00:01:10Z',
          protocol: 'udp',
          revision: 9,
          schemaVersion: 2,
          type: 'published',
        }),
      ),
    ).toMatchObject({ mechanism: 'udp_natmap', protocol: 'udp' });

    const ordinaryUdp = buildDesiredSnapshotV2(state, [
      {
        desiredPresence: 'present' as const,
        desiredRevision: '9',
        externalPort: 9000,
        groupId: '4',
        id: '40',
        internalPort: 9001,
        keeperDesiredEnabled: true,
        name: 'Ordinary UDP',
        natmapDesiredEnabled: false,
        protocol: 'udp' as const,
        targetIpv4: '192.168.31.224',
      },
    ]);
    expect(ordinaryUdp.channels[0]).toMatchObject({
      keeperDesiredEnabled: true,
      protocol: 'udp',
    });
    expect(ordinaryUdp.channels[0]).not.toHaveProperty('natmapDesiredEnabled');
  });

  it('sorts built channels canonically and returns a snapshot accepted by the strict parser', () => {
    const state = {
      agentId: 'nas-main',
      desiredIssuedAt: new Date('2026-07-26T00:01:10Z'),
      desiredRevision: '7',
    };
    const channel = (id: string) => ({
      desiredPresence: 'present' as const,
      desiredRevision: '7',
      externalPort: 48213,
      groupId: '1',
      id,
      internalPort: 48213,
      keeperDesiredEnabled: false,
      name: `channel-${id}`,
      natmapDesiredEnabled: true,
      protocol: 'tcp' as const,
      targetIpv4: '192.168.31.224',
    });

    const desired = buildDesiredSnapshotV2(state, [
      channel('20'),
      channel('10'),
    ]);
    expect(desired.channels.map((item) => item.channelId)).toEqual([
      '10',
      '20',
    ]);
    expect(parseDesiredSnapshotV2(JSON.stringify(desired))).toEqual(desired);
  });

  it('rejects duplicate channel IDs and rows invalid under the strict desired contract', () => {
    const state = {
      agentId: 'nas-main',
      desiredIssuedAt: new Date('2026-07-26T00:01:10Z'),
      desiredRevision: '7',
    };
    const channel = {
      desiredPresence: 'present' as const,
      desiredRevision: '7',
      externalPort: 48213,
      groupId: '1',
      id: '10',
      internalPort: 48213,
      keeperDesiredEnabled: false,
      name: 'TCP NATMap',
      natmapDesiredEnabled: true,
      protocol: 'tcp' as const,
      targetIpv4: '192.168.31.224',
    };

    expect(() =>
      buildDesiredSnapshotV2(state, [channel, { ...channel }]),
    ).toThrow();
    expect(() =>
      buildDesiredSnapshotV2(state, [{ ...channel, externalPort: 0 }]),
    ).toThrow();
  });
});
