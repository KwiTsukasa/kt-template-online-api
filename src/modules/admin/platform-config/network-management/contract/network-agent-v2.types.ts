import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { TextDecoder } from 'node:util';
import type { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import type { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import type { EndpointMechanism } from './network-management.types';

export const NETWORK_AGENT_V2_SCHEMA_VERSION = 2 as const;
export const NETWORK_AGENT_V2_MAX_CHANNELS = 64;
export const NETWORK_AGENT_V2_MAX_MESSAGE_BYTES = 256 * 1024;
const WIREGUARD_TARGET_IPV4 = '192.168.31.81';
const WIREGUARD_NATMAP_EXTERNAL_PORT = 51_825;
const WIREGUARD_TARGET_PORT = 51_820;

export type NetworkV2Protocol = 'tcp' | 'udp';
export type NetworkV2DesiredPresence = 'absent' | 'present';
export type NetworkV2SyncStatus =
  | 'conflict'
  | 'deleting'
  | 'failed'
  | 'pending'
  | 'synced'
  | 'syncing';
export type NetworkV2KeeperStatus =
  | 'active'
  | 'disabled'
  | 'failed'
  | 'stale'
  | 'starting';
export type NetworkV2NatmapStatus =
  | 'active'
  | 'disabled'
  | 'failed'
  | 'stale'
  | 'starting'
  | 'stopping';
export type NetworkV2EndpointMechanism = EndpointMechanism;
export type NetworkV2EndpointEventType =
  | 'changed'
  | 'published'
  | 'restored'
  | 'withdrawn';

type DesiredChannelBaseV2 = {
  channelDesiredDigest: string;
  channelDesiredRevision: number;
  channelId: string;
  desiredPresence: NetworkV2DesiredPresence;
  externalPort: number;
  groupId: string;
  internalPort: number;
  name: string;
};

export type NetworkDesiredChannelV2 =
  | (DesiredChannelBaseV2 & {
      natmapDesiredEnabled: boolean;
      protocol: 'tcp';
    })
  | (DesiredChannelBaseV2 & {
      keeperDesiredEnabled: boolean;
      probeRequestId?: string;
      protocol: 'udp';
    })
  | (DesiredChannelBaseV2 & {
      natmapDesiredEnabled: boolean;
      protocol: 'udp';
    });

export type NetworkDesiredSnapshotV2 = {
  agentId: string;
  channels: NetworkDesiredChannelV2[];
  issuedAt: string;
  schemaVersion: typeof NETWORK_AGENT_V2_SCHEMA_VERSION;
  snapshotDigest: string;
  snapshotRevision: number;
};

type NetworkDesiredChannelSourceV2 = Pick<
  NetworkPortForward,
  | 'desiredPresence'
  | 'desiredRevision'
  | 'externalPort'
  | 'groupId'
  | 'id'
  | 'internalPort'
  | 'keeperDesiredEnabled'
  | 'name'
  | 'natmapDesiredEnabled'
  | 'probeRequestId'
  | 'protocol'
  | 'targetIpv4'
>;

export type NetworkEndpointLeaseV2 = {
  mechanism: NetworkV2EndpointMechanism;
  observedAt: string;
  publicIpv4: string;
  publicPort: number;
  validatedAt: string;
  validUntil: string;
};

type ReportedChannelBaseV2 = {
  appliedDesiredDigest: string;
  appliedDesiredRevision: number;
  channelId: string;
  desiredPresence: NetworkV2DesiredPresence;
  errorCode?: string;
  errorMessage?: string;
  groupId: string;
  protocol: NetworkV2Protocol;
  routerPresent: boolean;
  syncStatus: NetworkV2SyncStatus;
};

export type NetworkReportedChannelV2 =
  | (ReportedChannelBaseV2 & {
      candidateEndpoint?: NetworkEndpointLeaseV2;
      currentEndpoint?: NetworkEndpointLeaseV2;
      dnatPresent: boolean;
      instanceGeneration?: string;
      lastObservedEndpoint?: NetworkEndpointLeaseV2;
      natmapDesiredEnabled: boolean;
      natmapErrorCode?: string;
      natmapErrorMessage?: string;
      natmapStatus: NetworkV2NatmapStatus;
      protocol: 'tcp';
      routePresent?: boolean;
    })
  | (ReportedChannelBaseV2 & {
      currentEndpoint?: NetworkEndpointLeaseV2;
      keeperDesiredEnabled: boolean;
      keeperErrorCode?: string;
      keeperErrorMessage?: string;
      keeperStatus: NetworkV2KeeperStatus;
      lastObservedEndpoint?: NetworkEndpointLeaseV2;
      lastProbeRequestId?: string;
      protocol: 'udp';
      routePresent: boolean;
    })
  | (ReportedChannelBaseV2 & {
      candidateEndpoint?: NetworkEndpointLeaseV2;
      currentEndpoint?: NetworkEndpointLeaseV2;
      instanceGeneration?: string;
      lastObservedEndpoint?: NetworkEndpointLeaseV2;
      natmapDesiredEnabled: boolean;
      natmapErrorCode?: string;
      natmapErrorMessage?: string;
      natmapStatus: NetworkV2NatmapStatus;
      protocol: 'udp';
    });

export type NetworkReportedSnapshotV2 = {
  agentId: string;
  channels: NetworkReportedChannelV2[];
  reportedAt: string;
  schemaVersion: typeof NETWORK_AGENT_V2_SCHEMA_VERSION;
  snapshotDigest: string;
  snapshotRevision: number;
};

export type NetworkStatusSnapshotV2 = {
  agentId: string;
  errorCode?: string;
  errorMessage?: string;
  observedAt: string;
  online: boolean;
  publicIpv6?: string;
  schemaVersion: typeof NETWORK_AGENT_V2_SCHEMA_VERSION;
  startedAt?: string;
  supportedSchemaVersions: [1, 2];
  tcpNatmapCapable: boolean;
  version?: string;
};

export type NetworkEndpointEventV2 = {
  agentId: string;
  channelId: string;
  endpoint?: NetworkEndpointLeaseV2;
  eventId: string;
  groupId: string;
  mechanism: NetworkV2EndpointMechanism;
  occurredAt: string;
  protocol: NetworkV2Protocol;
  reason?: string;
  revision: number;
  schemaVersion: typeof NETWORK_AGENT_V2_SCHEMA_VERSION;
  type: NetworkV2EndpointEventType;
};

export class NetworkV2MessageValidationError extends Error {}

const ID_PATTERN = /^\d{1,32}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
type NetworkV2WirePayload = Buffer | string;

/**
 * 根据`left`、`right`处理比较网络v2时间戳；当 `leftNanoseconds < rightNanoseconds` 成立时返回 `-1`。
 * @param left - 决定比较网络v2时间戳内容、边界或目标的 `left` 值。
 * @param right - 决定比较网络v2时间戳内容、边界或目标的 `right` 值。
 * @returns 当前状态对应的比较网络v2时间戳，取值为 `1`、`0`。
 */
export function compareNetworkV2Timestamps(
  left: string,
  right: string,
): number {
  const leftNanoseconds = rfc3339Nanoseconds(left);
  const rightNanoseconds = rfc3339Nanoseconds(right);
  if (leftNanoseconds < rightNanoseconds) {
    return -1;
  }
  if (leftNanoseconds > rightNanoseconds) {
    return 1;
  }
  return 0;
}

/**
 * 按规范字段顺序计算端点租约身份v2。
 * @param endpoint - 用于按规范字段顺序计算端点租约身份v2的领域对象，包含 `mechanism`、`observedAt`、`publicIpv4`、`publicPort` 字段。
 * @returns 按规范字段顺序计算端点租约身份v2。
 */
export function endpointLeaseIdentityV2(
  endpoint: NetworkEndpointLeaseV2,
): string {
  return digest({
    mechanism: endpoint.mechanism,
    observedAt: endpoint.observedAt,
    publicIpv4: endpoint.publicIpv4,
    publicPort: endpoint.publicPort,
    validatedAt: endpoint.validatedAt,
    validUntil: endpoint.validUntil,
  });
}

/**
 * 按固定顺序先规范化 V2 期望通道字段，再计算与字段顺序无关的稳定摘要。
 * @param channel - 决定按固定顺序先规范化 V2 期望通道字段，再计算与字段顺序无关的稳定摘要内容、边界或目标的 `channel` 值。
 * @returns 返回规范化 V2 期望通道的稳定内容摘要。
 */
export function canonicalDesiredChannelDigestV2(
  channel: NetworkDesiredChannelV2,
): string {
  return digest(canonicalDesiredChannelV2(channel));
}

/**
 * 按通道稳定顺序规范化 V2 期望快照，并计算版本、Agent 与通道集合的内容摘要。
 * @param snapshot - 用于canonicalDesired快照DigestV2的领域对象，包含 `schemaVersion`、`agentId`、`channels` 字段。
 * @returns 返回规范化并稳定排序后的 V2 期望快照摘要。
 */
export function canonicalDesiredSnapshotDigestV2(
  snapshot: Pick<
    NetworkDesiredSnapshotV2,
    'agentId' | 'channels' | 'schemaVersion'
  >,
): string {
  return digest({
    schemaVersion: snapshot.schemaVersion,
    agentId: snapshot.agentId,
    channels: [...snapshot.channels]
      .sort(compareDesiredChannelsV2)
      .map(canonicalDesiredChannelV2),
  });
}

/**
 * 根据`state`、`channels`构造期望的快照v2。
 * @param state - 用于期望的快照v2的领域对象，包含 `agentId`、`desiredIssuedAt`、`desiredRevision` 字段。
 * @param channels - 用于期望的快照v2的领域对象，包含 `length` 字段。
 * @returns 期望的快照v2。
 */
export function buildDesiredSnapshotV2(
  state: Pick<
    NetworkAgentState,
    'agentId' | 'desiredIssuedAt' | 'desiredRevision'
  >,
  channels: NetworkDesiredChannelSourceV2[],
): NetworkDesiredSnapshotV2 {
  if (channels.length > NETWORK_AGENT_V2_MAX_CHANNELS)
    invalid('desired.channels');
  const desiredChannels = channels
    .map((channel) => {
      const base = {
        channelDesiredDigest: '',
        channelDesiredRevision: safeRevisionFromString(
          channel.desiredRevision,
          'channelDesiredRevision',
        ),
        channelId: String(channel.id),
        desiredPresence: channel.desiredPresence,
        externalPort: channel.externalPort,
        groupId: String(channel.groupId),
        internalPort: channel.internalPort,
        name: channel.name,
      };
      const desired: NetworkDesiredChannelV2 = (() => {
        if (channel.protocol === 'tcp') {
          return {
            ...base,
            natmapDesiredEnabled: channel.natmapDesiredEnabled,
            protocol: 'tcp',
          };
        }
        if (
          channel.externalPort === WIREGUARD_NATMAP_EXTERNAL_PORT &&
          channel.internalPort === WIREGUARD_TARGET_PORT &&
          channel.targetIpv4 === WIREGUARD_TARGET_IPV4
        ) {
          return {
            ...base,
            natmapDesiredEnabled: channel.natmapDesiredEnabled,
            protocol: 'udp',
          };
        }
        return {
          ...base,
          keeperDesiredEnabled: channel.keeperDesiredEnabled,
          ...(() => {
            if (channel.probeRequestId) {
              return { probeRequestId: channel.probeRequestId };
            }
            return {};
          })(),
          protocol: 'udp',
        };
      })();
      desired.channelDesiredDigest = canonicalDesiredChannelDigestV2(desired);
      return desired;
    })
    .sort(compareDesiredChannelsV2);
  if (
    new Set(desiredChannels.map((channel) => channel.channelId)).size !==
    desiredChannels.length
  ) {
    invalid('desired duplicate channel');
  }
  const snapshot: NetworkDesiredSnapshotV2 = {
    agentId: state.agentId,
    channels: desiredChannels,
    issuedAt: isoFromDateTime(state.desiredIssuedAt, 'issuedAt'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    snapshotDigest: '',
    snapshotRevision: safeRevisionFromString(
      state.desiredRevision,
      'snapshotRevision',
    ),
  };
  snapshot.snapshotDigest = canonicalDesiredSnapshotDigestV2(snapshot);
  return parseDesiredSnapshotV2(JSON.stringify(snapshot));
}

/**
 * 从`payload`解析期望的快照v2；先通过 `validateDesiredSnapshotV2` 校验输入边界。
 * @param payload - 待按当前协议校验并路由的事件载荷。
 * @returns 期望的快照v2。
 */
export function parseDesiredSnapshotV2(
  payload: NetworkV2WirePayload,
): NetworkDesiredSnapshotV2 {
  return validateDesiredSnapshotV2(parseWirePayloadV2(payload));
}

/**
 * 校验`value`是否满足期望的快照v2约束，并拒绝不合法输入；先通过 `assertSchema` 校验输入边界。
 * @param value - 参与期望的快照v2比较、格式化或输出的候选值。
 * @returns 期望的快照v2。
 */
function validateDesiredSnapshotV2(value: unknown): NetworkDesiredSnapshotV2 {
  const record = exactRecord(
    value,
    [
      'agentId',
      'channels',
      'issuedAt',
      'schemaVersion',
      'snapshotDigest',
      'snapshotRevision',
    ],
    [],
    'desired',
  );
  assertSchema(record.schemaVersion);
  if (
    !Array.isArray(record.channels) ||
    record.channels.length > NETWORK_AGENT_V2_MAX_CHANNELS
  )
    invalid('desired.channels');
  const channels = record.channels.map(parseDesiredChannelV2);
  if (
    new Set(channels.map((channel) => channel.channelId)).size !==
    channels.length
  )
    invalid('desired duplicate channel');
  const snapshot: NetworkDesiredSnapshotV2 = {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channels,
    issuedAt: isoString(record.issuedAt, 'issuedAt'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    snapshotDigest: digestValue(record.snapshotDigest, 'snapshotDigest'),
    snapshotRevision: positiveRevision(
      record.snapshotRevision,
      'snapshotRevision',
    ),
  };
  if (canonicalDesiredSnapshotDigestV2(snapshot) !== snapshot.snapshotDigest)
    invalid('snapshotDigest');
  return snapshot;
}

/**
 * 从`payload`解析已报告的快照v2；先通过 `validateReportedSnapshotV2` 校验输入边界。
 * @param payload - 待按当前协议校验并路由的事件载荷。
 * @returns 已报告的快照v2。
 */
export function parseReportedSnapshotV2(
  payload: NetworkV2WirePayload,
): NetworkReportedSnapshotV2 {
  return validateReportedSnapshotV2(parseWirePayloadV2(payload));
}

/**
 * 校验`value`是否满足已报告的快照v2约束，并拒绝不合法输入；先通过 `assertSchema` 校验输入边界。
 * @param value - 参与已报告的快照v2比较、格式化或输出的候选值。
 * @returns 包含 `agentId`、`channels`、`reportedAt`、`schemaVersion`、`snapshotDigest` 字段的已报告的快照v2。
 */
function validateReportedSnapshotV2(value: unknown): NetworkReportedSnapshotV2 {
  const record = exactRecord(
    value,
    [
      'agentId',
      'channels',
      'reportedAt',
      'schemaVersion',
      'snapshotDigest',
      'snapshotRevision',
    ],
    [],
    'reported',
  );
  assertSchema(record.schemaVersion);
  if (
    !Array.isArray(record.channels) ||
    record.channels.length > NETWORK_AGENT_V2_MAX_CHANNELS
  )
    invalid('reported.channels');
  const channels = record.channels.map(parseReportedChannelV2);
  if (
    new Set(channels.map((channel) => channel.channelId)).size !==
    channels.length
  )
    invalid('reported duplicate channel');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channels,
    reportedAt: isoString(record.reportedAt, 'reportedAt'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    snapshotDigest: digestValue(record.snapshotDigest, 'snapshotDigest'),
    snapshotRevision: positiveRevision(
      record.snapshotRevision,
      'snapshotRevision',
    ),
  };
}

/**
 * 从`payload`解析状态快照v2；先通过 `validateStatusSnapshotV2` 校验输入边界。
 * @param payload - 待按当前协议校验并路由的事件载荷。
 * @returns 状态快照v2。
 */
export function parseStatusSnapshotV2(
  payload: NetworkV2WirePayload,
): NetworkStatusSnapshotV2 {
  return validateStatusSnapshotV2(parseWirePayloadV2(payload));
}

/**
 * 校验`value`是否满足状态快照v2约束，并拒绝不合法输入；先通过 `assertSchema` 校验输入边界。
 * @param value - 参与状态快照v2比较、格式化或输出的候选值。
 * @returns 包含 `agentId`、`observedAt`、`online`、`schemaVersion`、`supportedSchemaVersions` 字段的状态快照v2。
 */
function validateStatusSnapshotV2(value: unknown): NetworkStatusSnapshotV2 {
  const record = exactRecord(
    value,
    [
      'agentId',
      'observedAt',
      'online',
      'schemaVersion',
      'supportedSchemaVersions',
      'tcpNatmapCapable',
    ],
    ['errorCode', 'errorMessage', 'publicIpv6', 'startedAt', 'version'],
    'status',
  );
  assertSchema(record.schemaVersion);
  if (
    !Array.isArray(record.supportedSchemaVersions) ||
    record.supportedSchemaVersions.length !== 2 ||
    record.supportedSchemaVersions[0] !== 1 ||
    record.supportedSchemaVersions[1] !== 2
  )
    invalid('supportedSchemaVersions');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    ...(() => {
      if (record.errorCode === undefined) {
        return {};
      }
      return { errorCode: errorCode(record.errorCode, 'errorCode') };
    })(),
    ...(() => {
      if (record.errorMessage === undefined) {
        return {};
      }
      return {
        errorMessage: boundedString(record.errorMessage, 'errorMessage', 512),
      };
    })(),
    observedAt: isoString(record.observedAt, 'observedAt'),
    online: booleanValue(record.online, 'online'),
    ...(() => {
      if (record.publicIpv6 === undefined) {
        return {};
      }
      return { publicIpv6: publicIpv6(record.publicIpv6) };
    })(),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    ...(() => {
      if (record.startedAt === undefined) {
        return {};
      }
      return { startedAt: isoString(record.startedAt, 'startedAt') };
    })(),
    supportedSchemaVersions: [1, 2],
    tcpNatmapCapable: booleanValue(record.tcpNatmapCapable, 'tcpNatmapCapable'),
    ...(() => {
      if (record.version === undefined) {
        return {};
      }
      return { version: boundedString(record.version, 'version', 128) };
    })(),
  };
}

/**
 * 从`payload`解析端点事件v2；先通过 `validateEndpointEventV2` 校验输入边界。
 * @param payload - 待按当前协议校验并路由的事件载荷。
 * @returns 端点事件v2。
 */
export function parseEndpointEventV2(
  payload: NetworkV2WirePayload,
): NetworkEndpointEventV2 {
  return validateEndpointEventV2(parseWirePayloadV2(payload));
}

/**
 * 校验`value`是否满足端点事件v2约束，并拒绝不合法输入；先通过 `assertSchema` 校验输入边界。
 * @param value - 参与端点事件v2比较、格式化或输出的候选值。
 * @returns 包含 `agentId`、`channelId`、`eventId`、`groupId`、`mechanism` 字段的端点事件v2。
 */
function validateEndpointEventV2(value: unknown): NetworkEndpointEventV2 {
  const record = exactRecord(
    value,
    [
      'agentId',
      'channelId',
      'eventId',
      'groupId',
      'mechanism',
      'occurredAt',
      'protocol',
      'revision',
      'schemaVersion',
      'type',
    ],
    ['endpoint', 'reason'],
    'event',
  );
  assertSchema(record.schemaVersion);
  const protocol = enumValue(
    record.protocol,
    ['tcp', 'udp'] as const,
    'protocol',
  );
  const mechanism = enumValue(
    record.mechanism,
    ['tcp_natmap', 'udp_natmap', 'udp_stun'] as const,
    'mechanism',
  );
  const type = enumValue(
    record.type,
    ['changed', 'published', 'restored', 'withdrawn'] as const,
    'type',
  );
  if (
    (protocol === 'tcp' && mechanism !== 'tcp_natmap') ||
    (protocol === 'udp' && mechanism === 'tcp_natmap')
  )
    invalid('event mechanism');
  const endpoint = (() => {
    if (record.endpoint === undefined) {
      return undefined;
    }
    return parseEndpointV2(record.endpoint, mechanism);
  })();
  if ((type === 'withdrawn') !== (endpoint === undefined))
    invalid('event endpoint');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channelId: identifier(record.channelId, 'channelId'),
    ...(() => {
      if (endpoint === undefined) {
        return {};
      }
      return { endpoint };
    })(),
    eventId: requestId(record.eventId, 'eventId'),
    groupId: identifier(record.groupId, 'groupId'),
    mechanism,
    occurredAt: isoString(record.occurredAt, 'occurredAt'),
    protocol,
    ...(() => {
      if (record.reason === undefined) {
        return {};
      }
      return { reason: boundedString(record.reason, 'reason', 128) };
    })(),
    revision: positiveRevision(record.revision, 'revision'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    type,
  };
}

/**
 * 从`value`解析期望的通道v2。
 * @param value - 待转换为期望的通道v2的原始值。
 * @returns 期望的通道v2。
 */
function parseDesiredChannelV2(value: unknown): NetworkDesiredChannelV2 {
  const protocol = protocolOf(value, 'desired channel');
  const required = [
    'channelDesiredDigest',
    'channelDesiredRevision',
    'channelId',
    'desiredPresence',
    'externalPort',
    'groupId',
    'internalPort',
    'name',
    'protocol',
  ];
  const record = exactRecord(
    value,
    (() => {
      if (protocol === 'tcp') {
        return [...required, 'natmapDesiredEnabled'];
      }
      if (
        value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'natmapDesiredEnabled')
      ) {
        return [...required, 'natmapDesiredEnabled'];
      }
      return [...required, 'keeperDesiredEnabled'];
    })(),
    (() => {
      if (
        protocol === 'udp' &&
        value &&
        typeof value === 'object' &&
        !Object.hasOwn(value, 'natmapDesiredEnabled')
      ) {
        return ['probeRequestId'];
      }
      return [];
    })(),
    'desired channel',
  );
  const base = desiredBase(record);
  const channel = (() => {
    if (protocol === 'tcp') {
      return {
        ...base,
        natmapDesiredEnabled: booleanValue(
          record.natmapDesiredEnabled,
          'natmapDesiredEnabled',
        ),
        protocol,
      };
    }
    if (Object.hasOwn(record, 'natmapDesiredEnabled')) {
      return {
        ...base,
        natmapDesiredEnabled: booleanValue(
          record.natmapDesiredEnabled,
          'natmapDesiredEnabled',
        ),
        protocol,
      };
    }
    return {
      ...base,
      keeperDesiredEnabled: booleanValue(
        record.keeperDesiredEnabled,
        'keeperDesiredEnabled',
      ),
      ...(() => {
        if (record.probeRequestId === undefined) {
          return {};
        }
        return {
          probeRequestId: requestId(record.probeRequestId, 'probeRequestId'),
        };
      })(),
      protocol,
    };
  })();
  if (canonicalDesiredChannelDigestV2(channel) !== channel.channelDesiredDigest)
    invalid('channelDesiredDigest');
  return channel;
}

/**
 * 从`value`解析已报告的通道v2。
 * @param value - 待转换为已报告的通道v2的原始值。
 * @returns 包含 `currentEndpoint`、`keeperDesiredEnabled`、`keeperErrorCode`、`keeperErrorMessage`、`keeperStatus` 字段的已报告的通道v2。
 */
function parseReportedChannelV2(value: unknown): NetworkReportedChannelV2 {
  const protocol = protocolOf(value, 'reported channel');
  const common = [
    'appliedDesiredDigest',
    'appliedDesiredRevision',
    'channelId',
    'desiredPresence',
    'groupId',
    'protocol',
    'routerPresent',
    'syncStatus',
  ];
  const record = exactRecord(
    value,
    (() => {
      if (protocol === 'tcp') {
        return [
          ...common,
          'dnatPresent',
          'natmapDesiredEnabled',
          'natmapStatus',
        ];
      }
      if (
        value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'natmapDesiredEnabled')
      ) {
        return [...common, 'natmapDesiredEnabled', 'natmapStatus'];
      }
      return [
        ...common,
        'keeperDesiredEnabled',
        'keeperStatus',
        'routePresent',
      ];
    })(),
    (() => {
      if (protocol === 'tcp') {
        return [
          'candidateEndpoint',
          'currentEndpoint',
          'errorCode',
          'errorMessage',
          'instanceGeneration',
          'lastObservedEndpoint',
          'natmapErrorCode',
          'natmapErrorMessage',
          'routePresent',
        ];
      }
      if (
        value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'natmapDesiredEnabled')
      ) {
        return [
          'candidateEndpoint',
          'currentEndpoint',
          'errorCode',
          'errorMessage',
          'instanceGeneration',
          'lastObservedEndpoint',
          'natmapErrorCode',
          'natmapErrorMessage',
        ];
      }
      return [
        'currentEndpoint',
        'errorCode',
        'errorMessage',
        'keeperErrorCode',
        'keeperErrorMessage',
        'lastObservedEndpoint',
        'lastProbeRequestId',
      ];
    })(),
    'reported channel',
  );
  const base: ReportedChannelBaseV2 = {
    appliedDesiredDigest: digestValue(
      record.appliedDesiredDigest,
      'appliedDesiredDigest',
    ),
    appliedDesiredRevision: positiveRevision(
      record.appliedDesiredRevision,
      'appliedDesiredRevision',
    ),
    channelId: identifier(record.channelId, 'channelId'),
    desiredPresence: enumValue(
      record.desiredPresence,
      ['absent', 'present'] as const,
      'desiredPresence',
    ),
    ...(() => {
      if (record.errorCode === undefined) {
        return {};
      }
      return { errorCode: errorCode(record.errorCode, 'errorCode') };
    })(),
    ...(() => {
      if (record.errorMessage === undefined) {
        return {};
      }
      return {
        errorMessage: boundedString(record.errorMessage, 'errorMessage', 512),
      };
    })(),
    groupId: identifier(record.groupId, 'groupId'),
    protocol,
    routerPresent: booleanValue(record.routerPresent, 'routerPresent'),
    syncStatus: enumValue(
      record.syncStatus,
      [
        'conflict',
        'deleting',
        'failed',
        'pending',
        'synced',
        'syncing',
      ] as const,
      'syncStatus',
    ),
  };
  if (protocol === 'tcp')
    return {
      ...base,
      candidateEndpoint: optionalEndpoint(
        record.candidateEndpoint,
        'tcp_natmap',
      ),
      currentEndpoint: optionalEndpoint(record.currentEndpoint, 'tcp_natmap'),
      dnatPresent: booleanValue(record.dnatPresent, 'dnatPresent'),
      instanceGeneration: optionalBounded(
        record.instanceGeneration,
        'instanceGeneration',
        128,
      ),
      lastObservedEndpoint: optionalEndpoint(
        record.lastObservedEndpoint,
        'tcp_natmap',
      ),
      natmapDesiredEnabled: booleanValue(
        record.natmapDesiredEnabled,
        'natmapDesiredEnabled',
      ),
      natmapErrorCode: optionalErrorCode(
        record.natmapErrorCode,
        'natmapErrorCode',
      ),
      natmapErrorMessage: optionalBounded(
        record.natmapErrorMessage,
        'natmapErrorMessage',
        512,
      ),
      natmapStatus: enumValue(
        record.natmapStatus,
        [
          'active',
          'disabled',
          'failed',
          'stale',
          'starting',
          'stopping',
        ] as const,
        'natmapStatus',
      ),
      protocol,
      ...(() => {
        if (record.routePresent === undefined) {
          return {};
        }
        return {
          routePresent: booleanValue(record.routePresent, 'routePresent'),
        };
      })(),
    };
  if (Object.hasOwn(record, 'natmapDesiredEnabled')) {
    return {
      ...base,
      candidateEndpoint: optionalEndpoint(
        record.candidateEndpoint,
        'udp_natmap',
      ),
      currentEndpoint: optionalEndpoint(record.currentEndpoint, 'udp_natmap'),
      instanceGeneration: optionalBounded(
        record.instanceGeneration,
        'instanceGeneration',
        128,
      ),
      lastObservedEndpoint: optionalEndpoint(
        record.lastObservedEndpoint,
        'udp_natmap',
      ),
      natmapDesiredEnabled: booleanValue(
        record.natmapDesiredEnabled,
        'natmapDesiredEnabled',
      ),
      natmapErrorCode: optionalErrorCode(
        record.natmapErrorCode,
        'natmapErrorCode',
      ),
      natmapErrorMessage: optionalBounded(
        record.natmapErrorMessage,
        'natmapErrorMessage',
        512,
      ),
      natmapStatus: enumValue(
        record.natmapStatus,
        [
          'active',
          'disabled',
          'failed',
          'stale',
          'starting',
          'stopping',
        ] as const,
        'natmapStatus',
      ),
      protocol,
    };
  }
  return {
    ...base,
    currentEndpoint: optionalEndpoint(record.currentEndpoint, 'udp_stun'),
    keeperDesiredEnabled: booleanValue(
      record.keeperDesiredEnabled,
      'keeperDesiredEnabled',
    ),
    keeperErrorCode: optionalErrorCode(
      record.keeperErrorCode,
      'keeperErrorCode',
    ),
    keeperErrorMessage: optionalBounded(
      record.keeperErrorMessage,
      'keeperErrorMessage',
      512,
    ),
    keeperStatus: enumValue(
      record.keeperStatus,
      ['active', 'disabled', 'failed', 'stale', 'starting'] as const,
      'keeperStatus',
    ),
    lastObservedEndpoint: optionalEndpoint(
      record.lastObservedEndpoint,
      'udp_stun',
    ),
    lastProbeRequestId: (() => {
      if (record.lastProbeRequestId === undefined) {
        return undefined;
      }
      return requestId(record.lastProbeRequestId, 'lastProbeRequestId');
    })(),
    protocol,
    routePresent: booleanValue(record.routePresent, 'routePresent'),
  };
}

/**
 * 把领域字段投影为期望的Base。
 * @param record - 用于把领域字段投影为期望的Base的领域对象，包含 `channelDesiredDigest`、`channelDesiredRevision`、`channelId`、`desiredPresence` 字段。
 * @returns 包含 `channelDesiredDigest`、`channelDesiredRevision`、`channelId`、`desiredPresence`、`externalPort` 字段的把领域字段投影为期望的Base。
 */
function desiredBase(record: Record<string, unknown>): DesiredChannelBaseV2 {
  return {
    channelDesiredDigest: digestValue(
      record.channelDesiredDigest,
      'channelDesiredDigest',
    ),
    channelDesiredRevision: positiveRevision(
      record.channelDesiredRevision,
      'channelDesiredRevision',
    ),
    channelId: identifier(record.channelId, 'channelId'),
    desiredPresence: enumValue(
      record.desiredPresence,
      ['absent', 'present'] as const,
      'desiredPresence',
    ),
    externalPort: port(record.externalPort, 'externalPort'),
    groupId: identifier(record.groupId, 'groupId'),
    internalPort: port(record.internalPort, 'internalPort'),
    name: boundedString(record.name, 'name', 128),
  };
}

/**
 * 严格校验 V2 公网端点的字段集合、机制、地址、端口与租约时间，并拒绝与期望机制不一致的事件。
 * @param value - 待转换为端点v2的原始值。
 * @param expectedMechanism - 决定端点v2内容、边界或目标的 `expectedMechanism` 值。
 * @returns 包含 `mechanism`、`observedAt`、`publicIpv4`、`publicPort`、`validatedAt` 字段的端点v2。
 */
function parseEndpointV2(
  value: unknown,
  expectedMechanism: NetworkV2EndpointMechanism,
): NetworkEndpointLeaseV2 {
  const record = exactRecord(
    value,
    [
      'mechanism',
      'observedAt',
      'publicIpv4',
      'publicPort',
      'validatedAt',
      'validUntil',
    ],
    [],
    'endpoint',
  );
  const mechanism = enumValue(
    record.mechanism,
    ['tcp_natmap', 'udp_natmap', 'udp_stun'] as const,
    'mechanism',
  );
  if (mechanism !== expectedMechanism) invalid('endpoint mechanism');
  const observedAt = isoString(record.observedAt, 'observedAt');
  const validatedAt = isoString(record.validatedAt, 'validatedAt');
  const validUntil = isoString(record.validUntil, 'validUntil');
  if (compareNetworkV2Timestamps(validUntil, observedAt) <= 0)
    invalid('endpoint validity');
  return {
    mechanism,
    observedAt,
    publicIpv4: publicIpv4(record.publicIpv4),
    publicPort: port(record.publicPort, 'publicPort'),
    validatedAt,
    validUntil,
  };
}

/**
 * 按当前约束判定规范的期望的通道v2。
 * @param channel - 用于规范的期望的通道v2的领域对象，包含 `protocol`、`channelId`、`desiredPresence`、`externalPort` 字段。
 * @returns 满足规范的期望的通道v2约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function canonicalDesiredChannelV2(channel: NetworkDesiredChannelV2): object {
  if (channel.protocol === 'tcp')
    return {
      channelId: channel.channelId,
      desiredPresence: channel.desiredPresence,
      externalPort: channel.externalPort,
      groupId: channel.groupId,
      internalPort: channel.internalPort,
      name: channel.name,
      natmapDesiredEnabled: channel.natmapDesiredEnabled,
      protocol: channel.protocol,
    };
  if ('natmapDesiredEnabled' in channel) {
    return {
      channelId: channel.channelId,
      desiredPresence: channel.desiredPresence,
      externalPort: channel.externalPort,
      groupId: channel.groupId,
      internalPort: channel.internalPort,
      name: channel.name,
      natmapDesiredEnabled: channel.natmapDesiredEnabled,
      protocol: channel.protocol,
    };
  }
  return {
    channelId: channel.channelId,
    desiredPresence: channel.desiredPresence,
    externalPort: channel.externalPort,
    groupId: channel.groupId,
    internalPort: channel.internalPort,
    keeperDesiredEnabled: channel.keeperDesiredEnabled,
    name: channel.name,
    ...(() => {
      if (channel.probeRequestId === undefined) {
        return {};
      }
      return { probeRequestId: channel.probeRequestId };
    })(),
    protocol: channel.protocol,
  };
}

/**
 * 根据`left`、`right`处理比较期望的通道v2。
 * @param left - 用于比较期望的通道v2的领域对象，包含 `channelId`、`protocol`、`externalPort` 字段。
 * @param right - 用于比较期望的通道v2的领域对象，包含 `channelId`、`protocol`、`externalPort` 字段。
 * @returns 规范化后的比较期望的通道v2；主值为空时采用 `left.externalPort - right.externalPort` 兜底。
 */
function compareDesiredChannelsV2(
  left: NetworkDesiredChannelV2,
  right: NetworkDesiredChannelV2,
): number {
  return (
    (() => {
      if (left.channelId < right.channelId) {
        return -1;
      }
      if (left.channelId > right.channelId) {
        return 1;
      }
      return 0;
    })() ||
    (() => {
      if (left.protocol < right.protocol) {
        return -1;
      }
      if (left.protocol > right.protocol) {
        return 1;
      }
      return 0;
    })() ||
    left.externalPort - right.externalPort
  );
}
/**
 * 从`payload`解析传输协议载荷v2。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `length` 字段。
 * @returns 传输协议载荷v2。
 */
function parseWirePayloadV2(payload: NetworkV2WirePayload): unknown {
  let text: string;
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload, 'utf8') > NETWORK_AGENT_V2_MAX_MESSAGE_BYTES)
      invalid('message size');
    text = payload;
  } else if (Buffer.isBuffer(payload)) {
    if (payload.length > NETWORK_AGENT_V2_MAX_MESSAGE_BYTES)
      invalid('message size');
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    } catch {
      invalid('message UTF-8');
    }
  } else {
    invalid('message payload');
  }
  try {
    return JSON.parse(text);
  } catch {
    invalid('message JSON');
  }
}
/**
 * 保留空值并规范化可选的端点。
 * @param value - 参与保留空值并规范化可选的端点比较、格式化或输出的候选值。
 * @param mechanism - 决定保留空值并规范化可选的端点内容、边界或目标的 `mechanism` 值。
 * @returns 保留空值并规范化可选的端点；没有可用结果或提前结束时为 `undefined`。
 */
function optionalEndpoint(
  value: unknown,
  mechanism: NetworkV2EndpointMechanism,
): NetworkEndpointLeaseV2 | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseEndpointV2(value, mechanism);
}
/**
 * 保留空值并规范化可选的有界的。
 * @param value - 参与保留空值并规范化可选的有界的比较、格式化或输出的候选值。
 * @param name - 决定保留空值并规范化可选的有界的内容、边界或目标的 `name` 值。
 * @param max - 决定保留空值并规范化可选的有界的内容、边界或目标的 `max` 值。
 * @returns 保留空值并规范化可选的有界的；没有可用结果或提前结束时为 `undefined`。
 */
function optionalBounded(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return boundedString(value, name, max);
}
/**
 * 保留空值并规范化可选的错误代码。
 * @param value - 参与保留空值并规范化可选的错误代码比较、格式化或输出的候选值。
 * @param name - 决定保留空值并规范化可选的错误代码内容、边界或目标的 `name` 值。
 * @returns 保留空值并规范化可选的错误代码；没有可用结果或提前结束时为 `undefined`。
 */
function optionalErrorCode(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return errorCode(value, name);
}
/**
 * 根据`value`、`name`处理输入约束并返回协议所属。
 * @param value - 参与输入约束并返回协议所属比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回协议所属内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回协议所属。
 */
function protocolOf(value: unknown, name: string): NetworkV2Protocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid(name);
  return enumValue(
    (value as Record<string, unknown>).protocol,
    ['tcp', 'udp'] as const,
    'protocol',
  );
}
/**
 * 根据`value`、`required`、`optional`处理输入约束并返回精确记录。
 * @param value - 参与输入约束并返回精确记录比较、格式化或输出的候选值。
 * @param required - 决定是否启用“required”分支的布尔选项。
 * @param optional - 决定输入约束并返回精确记录内容、边界或目标的 `optional` 值。
 * @param name - 决定输入约束并返回精确记录内容、边界或目标的 `name` 值。
 * @param allowPartial - 决定是否启用“allowPartial”分支的布尔选项；省略时默认采用 `false`。
 * @returns 输入约束并返回精确记录。
 */
function exactRecord(
  value: unknown,
  required: string[],
  optional: string[],
  name: string,
  allowPartial = false,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid(name);
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    (!allowPartial && required.some((key) => !(key in record)))
  )
    invalid(name);
  return record;
}
/**
 * 要求网络 Agent v2 载荷声明固定协议版本，版本不匹配时进入统一字段校验失败边界。
 * @param value - 载荷中待核对的 `schemaVersion` 字段值。
 */
function assertSchema(value: unknown): void {
  if (value !== NETWORK_AGENT_V2_SCHEMA_VERSION) invalid('schemaVersion');
}
/**
 * 根据`value`、`name`处理输入约束并返回标识符。
 * @param value - 参与输入约束并返回标识符比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回标识符内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回标识符。
 */
function identifier(value: unknown, name: string): string {
  const result = stringValue(value, name, 32);
  if (!ID_PATTERN.test(result)) invalid(name);
  return result;
}
/**
 * 将协议字段校验为不超过 128 字符且只含字母、数字、下划线或连字符的请求标识。
 * @param value - 参与标识比较、格式化或输出的候选值。
 * @param name - 决定标识内容、边界或目标的 `name` 值。
 * @returns 标识。
 */
function requestId(value: unknown, name: string): string {
  const result = stringValue(value, name, 128);
  if (!REQUEST_ID_PATTERN.test(result)) invalid(name);
  return result;
}
/**
 * 根据`value`、`name`处理输入约束并返回摘要值。
 * @param value - 参与输入约束并返回摘要值比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回摘要值内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回摘要值。
 */
function digestValue(value: unknown, name: string): string {
  const result = stringValue(value, name, 64);
  if (!/^[0-9a-f]{64}$/.test(result)) invalid(name);
  return result;
}
/**
 * 根据`value`、`name`处理输入约束并返回错误代码。
 * @param value - 参与输入约束并返回错误代码比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回错误代码内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回错误代码。
 */
function errorCode(value: unknown, name: string): string {
  const result = stringValue(value, name, 64);
  if (!ERROR_CODE_PATTERN.test(result)) invalid(name);
  return result;
}
/**
 * 根据`value`、`name`、`max`处理输入约束并返回有界的字符串。
 * @param value - 参与输入约束并返回有界的字符串比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回有界的字符串内容、边界或目标的 `name` 值。
 * @param max - 决定输入约束并返回有界的字符串内容、边界或目标的 `max` 值。
 * @returns 输入约束并返回有界的字符串。
 */
function boundedString(value: unknown, name: string, max: number): string {
  const result = stringValue(value, name, max);
  if (result.length === 0) invalid(name);
  return result;
}
/**
 * 按协议约束校验字段为字符串且 UTF-8 字节数不超过上限，空字符串仍由上层字段规则决定是否允许。
 * @param value - 待验证类型和 UTF-8 长度的协议字段值。
 * @param name - 字段校验失败时写入异常的协议字段名。
 * @param max - 允许的最大 UTF-8 字节数。
 * @returns 保持内容不变的已验证字符串。
 */
function stringValue(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > max)
    invalid(name);
  return value;
}
/**
 * 根据`value`、`name`处理输入约束并返回正数版本。
 * @param value - 参与输入约束并返回正数版本比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回正数版本内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回正数版本。
 */
function positiveRevision(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    invalid(name);
  return value;
}
/**
 * 根据`value`、`name`处理输入约束并返回安全版本来自字符串。
 * @param value - 参与输入约束并返回安全版本来自字符串比较、格式化或输出的候选值。
 * @param name - 决定输入约束并返回安全版本来自字符串内容、边界或目标的 `name` 值。
 * @returns 输入约束并返回安全版本来自字符串。
 */
function safeRevisionFromString(value: string, name: string): number {
  if (!/^\d+$/.test(value)) invalid(name);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) invalid(name);
  return Number(parsed);
}
/**
 * 按当前约束判定ISO来自日期时间。
 * @param value - 待转换的时间值；接受可由 `Date` 构造的字符串、数字或日期实例，无效时间会触发字段校验失败。
 * @param name - 决定ISO来自日期时间内容、边界或目标的 `name` 值。
 * @returns 满足ISO来自日期时间约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isoFromDateTime(value: unknown, name: string): string {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) invalid(name);
  return date.toISOString();
}
/**
 * 按协议约束校验端口为 1 至 65535 范围内的整数。
 * @param value - 待验证的协议端口值。
 * @param name - 端口校验失败时写入异常的协议字段名。
 * @returns 保持数值不变的有效 TCP 或 UDP 端口。
 */
function port(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  )
    invalid(name);
  return value;
}
/**
 * 要求协议字段为真正的布尔值，其他类型按字段名报告协议校验错误。
 * @param value - 参与布尔值比较、格式化或输出的候选值。
 * @param name - 决定布尔值内容、边界或目标的 `name` 值。
 * @returns 布尔值。
 */
function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') invalid(name);
  return value;
}
/**
 * 按协议约束校验字段为字符串且属于调用方给定的枚举成员集合。
 * @param value - 待匹配的协议枚举字段值。
 * @param allowed - 该协议字段允许采用的全部字符串成员。
 * @param name - 枚举校验失败时写入异常的协议字段名。
 * @returns 已确认属于允许集合的枚举成员。
 */
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(name);
  return value as T;
}
/**
 * 按当前约束判定ISO字符串。
 * @param value - 待判定是否满足ISO字符串约束的候选值。
 * @param name - 决定ISO字符串内容、边界或目标的 `name` 值。
 * @returns 满足ISO字符串约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isoString(value: unknown, name: string): string {
  const result = stringValue(value, name, 64);
  const match = RFC3339_PATTERN.exec(result);
  if (!match) invalid(name);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = (() => {
    if (match[8] === 'Z') {
      return 0;
    }
    return Number(match[10]);
  })();
  const offsetMinute = (() => {
    if (match[8] === 'Z') {
      return 0;
    }
    return Number(match[11]);
  })();
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    (() => {
      if (leapYear) {
        return 29;
      }
      return 28;
    })(),
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12) invalid(name);
  if (day < 1 || day > days[month - 1]) invalid(name);
  if (hour > 23 || minute > 59 || second > 59) invalid(name);
  if (offsetHour > 23 || offsetMinute > 59) invalid(name);
  if (Number.isNaN(Date.parse(result))) invalid(name);
  return result;
}
/**
 * 根据`value`处理输入约束并返回RFC3339纳秒。
 * @param value - 参与输入约束并返回RFC3339纳秒比较、格式化或输出的候选值。
 * @returns 输入约束并返回RFC3339纳秒。
 */
function rfc3339Nanoseconds(value: string): bigint {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) invalid('timestamp');
  const wholeSecond = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[8]}`;
  const wholeSecondMilliseconds = Date.parse(wholeSecond);
  if (Number.isNaN(wholeSecondMilliseconds)) invalid('timestamp');
  const fractionalNanoseconds = BigInt((match[7] || '').padEnd(9, '0'));
  return BigInt(wholeSecondMilliseconds) * 1_000_000n + fractionalNanoseconds;
}
/**
 * 根据`value`处理输入约束并返回公开的IPv4。
 * @param value - 参与输入约束并返回公开的IPv4比较、格式化或输出的候选值。
 * @returns 输入约束并返回公开的IPv4。
 */
function publicIpv4(value: unknown): string {
  const result = stringValue(value, 'publicIpv4', 15);
  const [a, b, c] = result.split('.').map(Number);
  if (isIP(result) !== 4) invalid('publicIpv4');
  if (a === 0 || a === 10 || a === 127 || a >= 224) invalid('publicIpv4');
  if (a === 100 && b >= 64 && b <= 127) invalid('publicIpv4');
  if (a === 169 && b === 254) invalid('publicIpv4');
  if (a === 172 && b >= 16 && b <= 31) invalid('publicIpv4');
  if (a === 192 && b === 168) invalid('publicIpv4');
  if (a === 192 && b === 0 && (c === 0 || c === 2)) invalid('publicIpv4');
  if (a === 192 && b === 88 && c === 99) invalid('publicIpv4');
  if (a === 198 && (b === 18 || b === 19)) invalid('publicIpv4');
  if (a === 198 && b === 51 && c === 100) invalid('publicIpv4');
  if (a === 203 && b === 0 && c === 113) invalid('publicIpv4');
  return result;
}
/**
 * 根据`value`处理输入约束并返回公开的IPv6。
 * @param value - 参与输入约束并返回公开的IPv6比较、格式化或输出的候选值。
 * @returns 输入约束并返回公开的IPv6。
 */
function publicIpv6(value: unknown): string {
  const result = stringValue(value, 'publicIpv6', 45);
  if (isIP(result) !== 6) invalid('publicIpv6');
  let normalized: string;
  try {
    const hostname = new URL(`http://[${result}]/`).hostname;
    normalized = hostname.slice(1, -1).toLowerCase();
  } catch {
    invalid('publicIpv6');
  }
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  if (
    !Number.isInteger(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff
  )
    invalid('publicIpv6');
  return normalized;
}
/**
 * 按规范字段顺序计算摘要。
 * @param value - 参与按规范字段顺序计算摘要比较、格式化或输出的候选值。
 * @returns 按规范字段顺序计算摘要。
 */
function digest(value: unknown): string {
  return createHash('sha256').update(goJsonStringify(value)).digest('hex');
}
/**
 * 按 Go JSON 的 HTML 安全转义约定序列化数据，确保 TypeScript 与 Agent 计算相同摘要。
 * @param value - 待稳定序列化并参与跨语言摘要计算的数据。
 * @returns 将五类 HTML 敏感字符转为 Unicode 转义序列的 JSON 文本。
 */
function goJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
/**
 * 根据字段标签构造并抛出网络消息校验异常，使所有协议解析失败保持统一错误边界。
 * @param name - 决定invalid内容、边界或目标的 `name` 值。
 * @throws 调用该字段校验拒绝函数时抛出对应网络消息校验异常，并在消息中包含字段名称。
 */
function invalid(name: string): never {
  throw new NetworkV2MessageValidationError(`invalid network v2 ${name}`);
}
