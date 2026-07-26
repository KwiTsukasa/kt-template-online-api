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
  natmapDesiredEnabled: true,
  protocolMode: 'tcp' as const,
  ...overrides,
});

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
    expect(() => service.assertMutationAllowed({ after: tcp() })).not.toThrow();
    expect(() =>
      service.assertMutationAllowed({ after: tcp({ externalPort: 48214 }) }),
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
          before: tcp(),
          after: tcp({ natmapDesiredEnabled: false }),
        }),
      ).not.toThrow();
      expect(() =>
        service.assertMutationAllowed({
          before: { ...tcp(), protocolMode: 'tcp_udp' },
          after: { ...tcp(), natmapDesiredEnabled: false, protocolMode: 'udp' },
        }),
      ).not.toThrow();
      expect(() => service.assertMutationAllowed({ before: tcp() })).not.toThrow();
      expect(() =>
        service.assertMutationAllowed({ before: tcp(), after: { ...tcp(), protocolMode: 'udp' } }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({
          before: { ...tcp(), protocolMode: 'tcp_udp' },
          after: tcp(),
        }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({ after: tcp({ externalPort: 48214 }) }),
      ).toThrow(NetworkTcpReleasePolicyError);
      expect(() =>
        service.assertMutationAllowed({
          before: { externalPort: 8213, natmapDesiredEnabled: false, protocolMode: 'udp' },
          after: { externalPort: 8214, natmapDesiredEnabled: false, protocolMode: 'udp' },
        }),
      ).not.toThrow();
    },
  );
});
