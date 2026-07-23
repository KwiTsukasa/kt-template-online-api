import type { NetworkPortForward } from './network-management.entity';

/** Stable reason returned when a mapping cannot structurally act as a STUN endpoint source. */
export type StunEndpointSourceDisabledReason =
  | 'KEEPER_DISABLED'
  | 'PORT_MISMATCH'
  | 'SOURCE_DELETING'
  | 'UDP_REQUIRED';

/** Structural, lease-independent STUN source classification shared by DDNS and message delivery. */
export type StunEndpointSourceEligibility = {
  disabledReasonCode: null | StunEndpointSourceDisabledReason;
  eligible: boolean;
};

/**
 * Classifies whether a mapping may own a UDP STUN endpoint, excluding its current lease.
 * @param mapping - Persisted port-forward mapping including desired Keeper configuration.
 * @returns Stable structural eligibility and existing DDNS-compatible reason codes.
 */
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
