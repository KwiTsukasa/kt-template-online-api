import {
  buildDesiredSnapshot,
  desiredSnapshotDigest,
  desiredSnapshotBytes,
  parseEndpointEvent,
  parseReportedSnapshot,
  parseStatusSnapshot,
} from '../../../src/modules/admin/platform-config/network-management/network-management.types';
import { NetworkAgentState } from '../../../src/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/network-management.entity';

/**
 * Creates a stable singleton state fixture used by desired snapshot tests.
 * @returns Agent state at desired revision seven.
 */
function createAgentState(): NetworkAgentState {
  return Object.assign(new NetworkAgentState(), {
    agentId: 'nas-main',
    desiredIssuedAt: new Date('2026-07-22T01:02:03.000Z'),
    desiredRevision: '7',
    targetIpv4: '192.168.31.224',
  });
}

/**
 * Creates a persisted desired mapping fixture.
 * @param id - Stable Snowflake-like identifier.
 * @param externalPort - WAN-side port used to verify deterministic sorting.
 * @returns Desired UDP mapping entity.
 */
function createMapping(id: string, externalPort: number): NetworkPortForward {
  return Object.assign(new NetworkPortForward(), {
    desiredPresence: 'present',
    desiredRevision: '7',
    externalPort,
    id,
    internalPort: externalPort,
    keeperDesiredEnabled: true,
    name: `rule-${externalPort}`,
    probeRequestId: 'probe-1',
    protocol: 'udp',
    targetIpv4: '192.168.31.224',
  });
}

describe('network management MQTT contracts', () => {
  it('builds byte-stable, sorted, secret-free desired snapshots', () => {
    const state = createAgentState();
    const later = createMapping('200', 9001);
    const earlier = createMapping('100', 9000);

    const first = buildDesiredSnapshot(state, [later, earlier]);
    const second = buildDesiredSnapshot(state, [earlier, later]);

    expect(first.mappings.map((mapping) => mapping.id)).toEqual(['100', '200']);
    expect(first).toEqual(second);
    expect(desiredSnapshotBytes(first)).toEqual(desiredSnapshotBytes(second));
    expect(JSON.stringify(first)).not.toMatch(/password|secret|token/i);
    expect(first.mappings[0]).toMatchObject({ state: 'present' });
    expect(first.mappings[0]).not.toHaveProperty('desiredPresence');
    expect(first.mappings[0]).not.toHaveProperty('remark');
    expect(desiredSnapshotDigest(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      agentId: 'nas-main',
      issuedAt: '2026-07-22T01:02:03.000Z',
      revision: 7,
      schemaVersion: 1,
      targetIpv4: '192.168.31.224',
    });
  });

  it('matches the Go canonical desired digest fixture', () => {
    const mapping = createMapping('1', 9000);
    mapping.name = 'game';

    expect(
      desiredSnapshotDigest(
        buildDesiredSnapshot(createAgentState(), [mapping]),
      ),
    ).toBe('8f019e3947622cdb42beff79752cd158ace472798fd6c552f8f566e0698ac475');
  });

  it('uses Go lexical ID order and HTML escaping in a multi-mapping digest', () => {
    const idTwo = createMapping('2', 9000);
    idTwo.name = 'game';
    const idTen = createMapping('10', 9001);
    idTen.name = 'web<&>';
    idTen.protocol = 'tcp';
    idTen.keeperDesiredEnabled = false;
    idTen.probeRequestId = null;

    const snapshot = buildDesiredSnapshot(createAgentState(), [idTen, idTwo]);
    expect(snapshot.mappings.map((mapping) => mapping.id)).toEqual(['2', '10']);
    expect(desiredSnapshotDigest(snapshot)).toBe(
      'e8893dead692a35b7813c8e5009e12f9e0a1adaea7123862c46a923b5a7b1141',
    );
  });

  it('strictly parses reported, status, and endpoint event payloads', () => {
    expect(
      parseReportedSnapshot({
        agentId: 'nas-main',
        appliedRevision: 7,
        desiredDigest: 'd'.repeat(64),
        helperAppliedRevision: 7,
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
            desiredState: 'present',
            id: '100',
            keeperDesiredEnabled: true,
            keeperStatus: 'active',
            lastObservedEndpoint: {
              observedAt: '2026-07-22T01:02:04.000Z',
              publicIpv4: '8.8.8.8',
              publicPort: 45000,
              validUntil: '2026-07-22T01:04:04.000Z',
            },
            revision: 7,
            routePresent: true,
            routerPresent: true,
            syncStatus: 'synced',
          },
        ],
        reportedAt: '2026-07-22T01:02:04.000Z',
        schemaVersion: 1,
      }),
    ).toMatchObject({ appliedRevision: 7 });
    expect(
      parseStatusSnapshot({
        agentId: 'nas-main',
        observedAt: '2026-07-22T01:02:04Z',
        online: true,
        schemaVersion: 1,
        version: '0.1.0',
      }),
    ).toMatchObject({ online: true });
    expect(
      parseEndpointEvent({
        agentId: 'nas-main',
        eventId: 'event-1',
        endpoint: {
          observedAt: '2026-07-22T01:02:04.000Z',
          publicIpv4: '8.8.8.8',
          publicPort: 45000,
          validUntil: '2026-07-22T01:04:04.000Z',
        },
        mappingId: '100',
        occurredAt: '2026-07-22T01:02:04.000Z',
        revision: 7,
        schemaVersion: 1,
        type: 'published',
      }),
    ).toMatchObject({ eventId: 'event-1' });
  });

  it.each([
    ['wrong schema', { schemaVersion: 2 }],
    ['unknown field', { extra: true }],
    ['unsafe revision', { appliedRevision: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects malformed reported snapshots: %s', (_, patch) => {
    expect(() =>
      parseReportedSnapshot({
        agentId: 'nas-main',
        appliedRevision: 7,
        desiredDigest: 'd'.repeat(64),
        helperAppliedRevision: 0,
        helperDigest: '',
        helperStatus: 'unknown',
        mappings: [],
        reportedAt: '2026-07-22T01:02:04.000Z',
        schemaVersion: 1,
        ...patch,
      }),
    ).toThrow();
  });
});
