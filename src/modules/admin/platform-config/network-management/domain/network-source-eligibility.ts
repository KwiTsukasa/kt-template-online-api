import type { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';

export type StunEndpointSourceDisabledReason =
  | 'KEEPER_DISABLED'
  | 'PORT_MISMATCH'
  | 'SOURCE_DELETING'
  | 'UDP_REQUIRED';

export type StunEndpointSourceEligibility = {
  disabledReasonCode: null | StunEndpointSourceDisabledReason;
  eligible: boolean;
};

/**
 * 分类STUN端点来源，并输出固定投影 `disabledReasonCode`、`eligible` 字段。
 * @param mapping - 用于classifyStun端点来源的领域对象，包含 `isDeleted`、`desiredPresence`、`protocol`、`externalPort` 字段。
 * @returns 包含 `disabledReasonCode`、`eligible` 字段的classifyStun端点来源；无法解析或未命中时为 `null`。
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
