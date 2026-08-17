import type { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';

export type TcpNatmapEndpointSourceDisabledReason =
  | 'NATMAP_DISABLED'
  | 'SOURCE_DELETING'
  | 'TCP_REQUIRED';

export type TcpNatmapEndpointSourceEligibility = {
  disabledReasonCode: null | TcpNatmapEndpointSourceDisabledReason;
  eligible: boolean;
};

/**
 * 分类TCPNATMap端点来源，并输出固定投影 `disabledReasonCode`、`eligible` 字段。
 * @param mapping - 用于classifyTcpNATMap 转发端点来源的领域对象，包含 `isDeleted`、`desiredPresence`、`protocol`、`natmapDesiredEnabled` 字段。
 * @returns 包含 `disabledReasonCode`、`eligible` 字段的classifyTcpNATMap 转发端点来源；无法解析或未命中时为 `null`。
 */
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
