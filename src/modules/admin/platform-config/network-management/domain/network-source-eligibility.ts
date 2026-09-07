import type { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';

export type StunEndpointSourceDisabledReason =
  | 'KEEPER_DISABLED'
  | 'NATMAP_DISABLED'
  | 'PORT_MISMATCH'
  | 'SOURCE_DELETING'
  | 'UDP_REQUIRED';

export type StunEndpointSourceEligibility = {
  disabledReasonCode: null | StunEndpointSourceDisabledReason;
  eligible: boolean;
};

/**
 * 按 UDP 运行机制检查来源资格：WireGuard NATMap 使用自身开关，其余 Keeper 保留同端口约束。
 * @param mapping - 包含资源存续状态、端口、目标与保活机制开关的映射。
 * @returns 来源是否可用及对应机制的禁用原因。
 */
export function classifyStunEndpointSource(
  mapping: Pick<
    NetworkPortForward,
    | 'desiredPresence'
    | 'externalPort'
    | 'internalPort'
    | 'isDeleted'
    | 'keeperDesiredEnabled'
    | 'natmapDesiredEnabled'
    | 'protocol'
    | 'targetIpv4'
  >,
): StunEndpointSourceEligibility {
  let disabledReasonCode: null | StunEndpointSourceDisabledReason = null;
  if (mapping.isDeleted || mapping.desiredPresence !== 'present') {
    disabledReasonCode = 'SOURCE_DELETING';
  } else if (mapping.protocol !== 'udp') {
    disabledReasonCode = 'UDP_REQUIRED';
  } else if (isUdpNatmapEndpointSource(mapping)) {
    if (!mapping.natmapDesiredEnabled) {
      disabledReasonCode = 'NATMAP_DISABLED';
    }
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

/**
 * 按现有 Agent 固定转发身份识别 WireGuard UDP NATMap，禁用时仍保留机制身份。
 * @param mapping - 待核对协议、绑定端口、目标端口和目标地址的映射。
 * @returns 映射为发往 R4SE 的 WireGuard UDP NATMap 时返回 true。
 */
export function isUdpNatmapEndpointSource(
  mapping: Pick<
    NetworkPortForward,
    'protocol' | 'externalPort' | 'internalPort' | 'targetIpv4'
  >,
): boolean {
  return (
    mapping.protocol === 'udp' &&
    mapping.externalPort === 51_825 &&
    mapping.internalPort === 51_820 &&
    mapping.targetIpv4 === '192.168.31.81'
  );
}
