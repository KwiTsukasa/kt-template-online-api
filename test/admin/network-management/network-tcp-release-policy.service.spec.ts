import type { ConfigService } from '@nestjs/config';
import {
  NetworkTcpReleasePolicyError,
  NetworkTcpReleasePolicyService,
} from '../../../src/modules/admin/platform-config/network-management/network-tcp-release-policy.service';

function policy(values: Record<string, string | undefined>) {
  return new NetworkTcpReleasePolicyService({
    get: (key: string) => values[key],
  } as ConfigService);
}

const tcp = (overrides = {}) => ({
  externalPort: 48213,
  internalPort: 48213,
  natmapDesiredEnabled: true,
  protocolMode: 'tcp' as const,
  ...overrides,
});

const udp = (overrides = {}) => ({
  externalPort: 8213,
  internalPort: 8211,
  natmapDesiredEnabled: false,
  protocolMode: 'udp' as const,
  ...overrides,
});

const INVALID_MUTATION_MESSAGE = 'Invalid TCP NATMap mutation';
const validMutationCases = [
  {
    kind: 'create',
    mutation: { after: tcp(), kind: 'create' },
    stateKeys: ['after'],
  },
  {
    kind: 'update',
    mutation: { after: tcp(), before: tcp(), kind: 'update' },
    stateKeys: ['after', 'before'],
  },
  {
    kind: 'retry',
    mutation: { current: tcp(), kind: 'retry' },
    stateKeys: ['current'],
  },
  {
    kind: 'natmap-enable',
    mutation: { current: tcp(), kind: 'natmap-enable' },
    stateKeys: ['current'],
  },
  {
    kind: 'natmap-disable',
    mutation: {
      after: tcp({ natmapDesiredEnabled: false }),
      before: tcp(),
      kind: 'natmap-disable',
    },
    stateKeys: ['after', 'before'],
  },
  {
    kind: 'protocol-shrink',
    mutation: {
      after: udp({ externalPort: 48213, internalPort: 48213 }),
      before: tcp({ protocolMode: 'tcp_udp' }),
      kind: 'protocol-shrink',
    },
    stateKeys: ['after', 'before'],
  },
  {
    kind: 'delete',
    mutation: { current: tcp(), kind: 'delete' },
    stateKeys: ['current'],
  },
] as const;

function expectInvalidMutation(mutation: unknown): void {
  const service = policy({
    NETWORK_TCP_NATMAP_CANARY_PORTS: 'not-a-port',
    NETWORK_TCP_NATMAP_RELEASE_MODE: 'not-a-mode',
  });
  const validate = () => service.assertMutationAllowed(mutation as never);
  expect(validate).toThrow(NetworkTcpReleasePolicyError);
  expect(validate).toThrow(INVALID_MUTATION_MESSAGE);
}

describe('NetworkTcpReleasePolicyService', () => {
  it('fails closed by default and parses the four release modes', () => {
    expect(policy({}).readMode()).toBe('off');
    for (const mode of ['canary', 'draining', 'off', 'on'] as const) {
      expect(policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: mode }).readMode()).toBe(
        mode,
      );
    }
    expect(() =>
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'secret-mode' }).readMode(),
    ).toThrow(NetworkTcpReleasePolicyError);
    expect(() =>
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'secret-mode' }).readMode(),
    ).not.toThrow('secret-mode');
  });

  it('accepts only canonical canary ports and never includes the raw config in errors', () => {
    expect(
      [...policy({ NETWORK_TCP_NATMAP_CANARY_PORTS: '443,48213' }).readCanaryPorts()],
    ).toEqual([443, 48213]);
    for (const value of ['', '443,,48213', '0443', '+443', '0', '65536', '443,443', '8213', 'tcp']) {
      const service = policy({ NETWORK_TCP_NATMAP_CANARY_PORTS: value });
      if (!value) {
        expect(service.readCanaryPorts()).toEqual(new Set());
      } else {
        expect(() => service.readCanaryPorts()).toThrow(NetworkTcpReleasePolicyError);
        expect(() => service.readCanaryPorts()).not.toThrow(value);
      }
    }
  });

  it('limits canary TCP writes to the allowlist and hides TCP from ordinary Admin', () => {
    const service = policy({
      NETWORK_TCP_NATMAP_CANARY_PORTS: '48213',
      NETWORK_TCP_NATMAP_RELEASE_MODE: 'canary',
    });
    expect(() =>
      service.assertMutationAllowed({ after: tcp(), kind: 'create' }),
    ).not.toThrow();
    expect(() =>
      service.assertMutationAllowed({
        after: tcp({ externalPort: 48214 }),
        kind: 'create',
      }),
    ).toThrow(NetworkTcpReleasePolicyError);
    expect(service.isTcpVisibleToAdmin()).toBe(false);
    expect(
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'on' }).isTcpVisibleToAdmin(),
    ).toBe(true);
    expect(service.mayAutomaticallyActivateV2()).toBe(true);
    expect(
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'on' }).mayAutomaticallyActivateV2(),
    ).toBe(true);
    expect(
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'off' }).mayAutomaticallyActivateV2(),
    ).toBe(false);
    expect(
      policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'draining' }).mayAutomaticallyActivateV2(),
    ).toBe(false);
  });

  it.each(['draining', 'off'] as const)(
    '%s permits only safe TCP cleanup while preserving UDP-only writes',
    (mode) => {
      const service = policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: mode });
      expect(() =>
        service.assertMutationAllowed({
          kind: 'natmap-disable',
          before: tcp(),
          after: tcp({ natmapDesiredEnabled: false }),
        }),
      ).not.toThrow();
      expect(() =>
        service.assertMutationAllowed({
          kind: 'protocol-shrink',
          before: { ...tcp(), protocolMode: 'tcp_udp' },
          after: { ...tcp(), natmapDesiredEnabled: false, protocolMode: 'udp' },
        }),
      ).not.toThrow();
      expect(() =>
        service.assertMutationAllowed({ current: tcp(), kind: 'delete' }),
      ).not.toThrow();
      expect(() =>
        service.assertMutationAllowed({
          after: { ...tcp(), protocolMode: 'udp' },
          before: tcp(),
          kind: 'update',
        }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({
          kind: 'update',
          before: { ...tcp(), protocolMode: 'tcp_udp' },
          after: tcp(),
        }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({ current: tcp(), kind: 'retry' }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({ current: tcp(), kind: 'natmap-enable' }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({
          after: udp({ externalPort: 8214 }),
          before: udp(),
          kind: 'update',
        }),
      ).not.toThrow();
    },
  );

  it('requires an explicit safe cleanup kind and unchanged ports for protocol shrink', () => {
    const service = policy({ NETWORK_TCP_NATMAP_RELEASE_MODE: 'off' });
    expect(() =>
      service.assertMutationAllowed({
        after: {
          ...tcp(),
          externalPort: 48214,
          natmapDesiredEnabled: false,
          protocolMode: 'udp',
        },
        before: { ...tcp(), protocolMode: 'tcp_udp' },
        kind: 'protocol-shrink',
      }),
    ).toThrow(NetworkTcpReleasePolicyError);
    expect(() =>
      service.assertMutationAllowed({
        after: {
          ...tcp(),
          internalPort: 48214,
          natmapDesiredEnabled: false,
          protocolMode: 'udp',
        },
        before: { ...tcp(), protocolMode: 'tcp_udp' },
        kind: 'protocol-shrink',
      }),
    ).toThrow(NetworkTcpReleasePolicyError);
    expect(() =>
      service.assertMutationAllowed({
        before: tcp(),
        kind: 'update',
      } as never),
    ).toThrow(NetworkTcpReleasePolicyError);
    expect(() =>
      service.assertMutationAllowed({
        after: tcp(),
        before: tcp(),
        kind: 'natmap-disable',
      }),
    ).toThrow(NetworkTcpReleasePolicyError);
  });

  it('allows cleanup after a canary port leaves the allowlist but still gates retry', () => {
    const service = policy({
      NETWORK_TCP_NATMAP_CANARY_PORTS: '48214',
      NETWORK_TCP_NATMAP_RELEASE_MODE: 'canary',
    });
    expect(() =>
      service.assertMutationAllowed({ current: tcp(), kind: 'delete' }),
    ).not.toThrow();
    expect(() =>
      service.assertMutationAllowed({
        after: tcp({ natmapDesiredEnabled: false }),
        before: tcp(),
        kind: 'natmap-disable',
      }),
    ).not.toThrow();
    expect(() =>
      service.assertMutationAllowed({ current: tcp(), kind: 'retry' }),
    ).toThrow(NetworkTcpReleasePolicyError);
  });

  it.each(validMutationCases)(
    'accepts the exact valid $kind mutation record',
    ({ mutation }) => {
      expect(() =>
        policy({
          NETWORK_TCP_NATMAP_RELEASE_MODE: 'on',
        }).assertMutationAllowed(mutation),
      ).not.toThrow();
    },
  );

  it.each(validMutationCases)(
    'rejects malformed top-level and nested records for $kind before reading release config',
    ({ mutation, stateKeys }) => {
      const record = mutation as unknown as Record<string, unknown>;
      expectInvalidMutation({ ...record, unexpected: true });
      expectInvalidMutation(
        Object.fromEntries(
          Object.entries(record).filter(([key]) => key !== 'kind'),
        ),
      );

      for (const stateKey of stateKeys) {
        expectInvalidMutation(
          Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== stateKey),
          ),
        );
        for (const invalidState of [null, [], {}, 'tcp', 1]) {
          expectInvalidMutation({ ...record, [stateKey]: invalidState });
        }
        expectInvalidMutation({
          ...record,
          [stateKey]: {
            ...(record[stateKey] as Record<string, unknown>),
            unexpected: true,
          },
        });
      }
    },
  );

  it.each([
    ['missing protocol', { ...tcp(), protocolMode: undefined }],
    ['unknown protocol', { ...tcp(), protocolMode: 'icmp' }],
    ['missing external port', { ...tcp(), externalPort: undefined }],
    ['NaN external port', { ...tcp(), externalPort: Number.NaN }],
    ['fractional external port', { ...tcp(), externalPort: 48213.5 }],
    ['zero external port', { ...tcp(), externalPort: 0 }],
    ['out-of-range external port', { ...tcp(), externalPort: 65_536 }],
    ['string external port', { ...tcp(), externalPort: '48213' }],
    ['missing internal port', { ...tcp(), internalPort: undefined }],
    ['NaN internal port', { ...tcp(), internalPort: Number.NaN }],
    ['fractional internal port', { ...tcp(), internalPort: 48213.5 }],
    ['zero internal port', { ...tcp(), internalPort: 0 }],
    ['out-of-range internal port', { ...tcp(), internalPort: 65_536 }],
    ['string internal port', { ...tcp(), internalPort: '48213' }],
    [
      'missing NATMap intent',
      { ...tcp(), natmapDesiredEnabled: undefined },
    ],
    ['non-boolean NATMap intent', { ...tcp(), natmapDesiredEnabled: 1 }],
    ['UDP with NATMap enabled', { ...udp(), natmapDesiredEnabled: true }],
  ])('rejects a state with %s', (_label, after) => {
    expectInvalidMutation({ after, kind: 'create' });
  });

  it.each([
    [
      'NATMap enable on UDP',
      { current: udp(), kind: 'natmap-enable' },
    ],
    [
      'NATMap enable without enabled intent',
      {
        current: tcp({ natmapDesiredEnabled: false }),
        kind: 'natmap-enable',
      },
    ],
    [
      'NATMap disable on UDP',
      {
        after: udp(),
        before: udp(),
        kind: 'natmap-disable',
      },
    ],
    [
      'NATMap disable without an intent transition',
      {
        after: tcp(),
        before: tcp(),
        kind: 'natmap-disable',
      },
    ],
    [
      'protocol shrink from TCP-only',
      {
        after: udp({ externalPort: 48213, internalPort: 48213 }),
        before: tcp(),
        kind: 'protocol-shrink',
      },
    ],
  ])('rejects the impossible %s mutation', (_label, mutation) => {
    expectInvalidMutation(mutation);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'create'],
    ['number', 1],
    ['empty object', {}],
    ['unknown kind', { after: tcp(), kind: 'replace' }],
  ])('rejects a %s mutation container', (_label, mutation) => {
    expectInvalidMutation(mutation);
  });
});
