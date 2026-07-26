import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalDesiredChannelDigestV2,
  canonicalDesiredSnapshotDigestV2,
  parseDesiredSnapshotV2,
  parseEndpointEventV2,
  parseReportedSnapshotV2,
  parseStatusSnapshotV2,
} from '../../../src/modules/admin/platform-config/network-management/network-agent-v2.types';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as unknown;

describe('network agent MQTT v2 contract', () => {
  it('parses the shared desired fixture and validates both literal digests', () => {
    const desired = parseDesiredSnapshotV2(fixture('network-v2-desired.json'));
    expect(canonicalDesiredChannelDigestV2(desired.channels[0])).toBe(
      'b43a0472f2d627b99ee726a31056780892a8aedb8ad477ed4f93fe0f2877a797',
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
  ])('rejects %s before v2 messages reach transport', (_, patch) => {
    const value = fixture('network-v2-desired.json') as any;
    patch(value);
    expect(() => parseDesiredSnapshotV2(value)).toThrow();
  });

  it('parses protocol-correct reported fields and rejects cross-protocol fields', () => {
    expect(parseReportedSnapshotV2(fixture('network-v2-reported.json'))).toMatchObject({
      snapshotRevision: 7,
    });
    const value = fixture('network-v2-reported.json') as any;
    value.channels[0].routePresent = true;
    expect(() => parseReportedSnapshotV2(value)).toThrow();
  });

  it('accepts v2 status and matching endpoint events before transport routing', () => {
    expect(
      parseStatusSnapshotV2({
        agentId: 'nas-main', observedAt: '2026-07-26T00:01:10Z', online: true,
        schemaVersion: 2, supportedSchemaVersions: [1, 2], tcpNatmapCapable: true,
      }),
    ).toMatchObject({ online: true });
    expect(
      parseEndpointEventV2({
        agentId: 'nas-main', channelId: '10', eventId: 'event-1', groupId: '1',
        mechanism: 'tcp_natmap', occurredAt: '2026-07-26T00:01:10Z', protocol: 'tcp',
        revision: 7, schemaVersion: 2, type: 'withdrawn',
      }),
    ).toMatchObject({ type: 'withdrawn' });
  });
});
