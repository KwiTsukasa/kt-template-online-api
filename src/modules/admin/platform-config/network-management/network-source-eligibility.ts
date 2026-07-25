import type { NetworkPortForward } from './network-management.entity';

export type StunEndpointSourceDisabledReason =
  | 'KEEPER_DISABLED'
  | 'PORT_MISMATCH'
  | 'SOURCE_DELETING'
  | 'UDP_REQUIRED';

export type StunEndpointSourceEligibility = {
  disabledReasonCode: null | StunEndpointSourceDisabledReason;
  eligible: boolean;
};

export function classifyStunEndpointSource(
  mapping: Pick<
    NetworkPortForward,
    | 'desiredPresence'
    | 'externalPort'
    | 'internalPort'
    | 'isDeleted'
    | 'keeperDesiredEnabled'
    | 'protocol'
  >,
): StunEndpointSourceEligibility {
  let disabledReasonCode: null | StunEndpointSourceDisabledReason = null;
  if (mapping.isDeleted || mapping.desiredPresence !== 'present') {
    disabledReasonCode = 'SOURCE_DELETING';
  } else if (mapping.protocol !== 'udp') {
    disabledReasonCode = 'UDP_REQUIRED';
  } else if (mapping.externalPort !== mapping.internalPort) {
    disabledReasonCode = 'PORT_MISMATCH';
  } else if (!mapping.keeperDesiredEnabled) {
    disabledReasonCode = 'KEEPER_DISABLED';
  }
  return {
    disabledReasonCode,
    eligible: disabledReasonCode === null,
  };
}
