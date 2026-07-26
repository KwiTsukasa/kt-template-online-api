import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NETWORK_AGENT_V2_MAX_MESSAGE_BYTES,
  canonicalDesiredChannelDigestV2,
  canonicalDesiredSnapshotDigestV2,
  parseDesiredSnapshotV2,
  parseEndpointEventV2,
  parseReportedSnapshotV2,
  parseStatusSnapshotV2,
} from '../../../src/modules/admin/platform-config/network-management/network-agent-v2.types';

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
    ['UDP NATMap pair', (value: any) => (value.channels[0].natmapDesiredEnabled = true)],
    ['TCP Keeper pair', (value: any) => (value.channels[1].keeperDesiredEnabled = true)],
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

  it('parses protocol-correct reported fields and rejects cross-protocol fields', () => {
    expect(
      parseReportedSnapshotV2(rawFixture('network-v2-reported.json')),
    ).toMatchObject({ snapshotRevision: 7 });
    const value = fixture('network-v2-reported.json') as any;
    value.channels[0].routePresent = true;
    expect(() => parseReportedSnapshotV2(JSON.stringify(value))).toThrow();
  });

  it('accepts v2 status and matching endpoint events before transport routing', () => {
    expect(
      parseStatusSnapshotV2(JSON.stringify(statusValue())),
    ).toMatchObject({ online: true });
    expect(
      parseEndpointEventV2(JSON.stringify(eventValue())),
    ).toMatchObject({ type: 'withdrawn' });
  });

  it.each([
    ['desired', parseDesiredSnapshotV2, () => rawFixture('network-v2-desired.json')],
    ['reported', parseReportedSnapshotV2, () => rawFixture('network-v2-reported.json')],
    ['status', parseStatusSnapshotV2, () => JSON.stringify(statusValue())],
    ['event', parseEndpointEventV2, () => JSON.stringify(eventValue())],
  ])('enforces raw size and trailing JSON for %s', (_, parser, validPayload) => {
    expect(parser(validPayload())).toBeDefined();
    expect(() => parser(`${validPayload()}{}`)).toThrow();
    expect(() =>
      parser(Buffer.alloc(NETWORK_AGENT_V2_MAX_MESSAGE_BYTES + 1)),
    ).toThrow();
  });

  it('rejects invalid RFC3339 calendar dates and explicit null optionals', () => {
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({ ...statusValue(), observedAt: '2026-02-29T00:00:00Z' }),
      ),
    ).toThrow();
    expect(() =>
      parseStatusSnapshotV2(
        JSON.stringify({ ...statusValue(), version: null }),
      ),
    ).toThrow();
    expect(() =>
      parseEndpointEventV2(
        JSON.stringify({ ...eventValue(), endpoint: null }),
      ),
    ).toThrow();
  });

  it.each(['192.0.0.1', '::ffff:8.8.8.8'])(
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

  it('uses shared UTF-8 byte limits for name, version, and global IPv6', () => {
    const desiredWithName = (name: string) => {
      const value = fixture('network-v2-desired.json');
      value.channels[0].name = name;
      value.channels[0].channelDesiredDigest =
        canonicalDesiredChannelDigestV2(value.channels[0]);
      value.snapshotDigest = canonicalDesiredSnapshotDigestV2(value);
      return JSON.stringify(value);
    };
    expect(parseDesiredSnapshotV2(desiredWithName('界'.repeat(42)))).toBeDefined();
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
});
