import type { NetworkPortForward } from './network-management.entity';

export type TcpNatmapEndpointSourceDisabledReason =
  | 'NATMAP_DISABLED'
  | 'SOURCE_DELETING'
  | 'TCP_REQUIRED';

export type TcpNatmapEndpointSourceEligibility = {
  disabledReasonCode: null | TcpNatmapEndpointSourceDisabledReason;
  eligible: boolean;
};

export function classifyTcpNatmapEndpointSource(
  mapping: Pick<
    NetworkPortForward,
    'desiredPresence' | 'isDeleted' | 'natmapDesiredEnabled' | 'protocol'
  >,
): TcpNatmapEndpointSourceEligibility {
  let disabledReasonCode: null | TcpNatmapEndpointSourceDisabledReason = null;
  if (mapping.isDeleted || mapping.desiredPresence !== 'present') {
    disabledReasonCode = 'SOURCE_DELETING';
  } else if (mapping.protocol !== 'tcp') {
    disabledReasonCode = 'TCP_REQUIRED';
  } else if (!mapping.natmapDesiredEnabled) {
    disabledReasonCode = 'NATMAP_DISABLED';
  }
  return {
    disabledReasonCode,
    eligible: disabledReasonCode === null,
  };
}
