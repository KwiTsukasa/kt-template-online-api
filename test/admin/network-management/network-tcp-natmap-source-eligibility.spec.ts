import { classifyTcpNatmapEndpointSource } from '../../../src/modules/admin/platform-config/network-management/domain/network-tcp-natmap-source-eligibility';

function source(overrides: Record<string, unknown> = {}) {
  return {
    desiredPresence: 'present' as const,
    isDeleted: false,
    natmapDesiredEnabled: true,
    protocol: 'tcp' as const,
    ...overrides,
  };
}

describe('classifyTcpNatmapEndpointSource', () => {
  it('accepts only a managed TCP channel with NATMap enabled', () => {
    expect(classifyTcpNatmapEndpointSource(source())).toEqual({
      disabledReasonCode: null,
      eligible: true,
    });
  });

  it.each([
    [
      { desiredPresence: 'absent' },
      { disabledReasonCode: 'SOURCE_DELETING', eligible: false },
    ],
    [
      { isDeleted: true },
      { disabledReasonCode: 'SOURCE_DELETING', eligible: false },
    ],
    [
      { protocol: 'udp' },
      { disabledReasonCode: 'TCP_REQUIRED', eligible: false },
    ],
    [
      { natmapDesiredEnabled: false },
      { disabledReasonCode: 'NATMAP_DISABLED', eligible: false },
    ],
  ])('classifies %j without changing STUN semantics', (input, expected) => {
    expect(classifyTcpNatmapEndpointSource(source(input))).toEqual(expected);
  });
});
