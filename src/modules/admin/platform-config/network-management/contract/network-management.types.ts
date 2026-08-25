import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { KtDateTime } from '@/common';
import type { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import type { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';

export const NETWORK_AGENT_SCHEMA_VERSION = 1 as const;
export const NETWORK_AGENT_MAX_MAPPINGS = 64;
const RFC3339_NANO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type PortForwardProtocol = 'tcp' | 'udp';
export type DesiredPresence = 'absent' | 'present';
export type PortForwardSyncStatus =
  | 'conflict'
  | 'deleting'
  | 'failed'
  | 'pending'
  | 'synced'
  | 'syncing';
export type KeeperStatus =
  | 'active'
  | 'disabled'
  | 'failed'
  | 'stale'
  | 'starting';
export type HelperStatus = 'confirmed' | 'failed' | 'unknown';
export type EndpointEventType =
  | 'changed'
  | 'published'
  | 'restored'
  | 'withdrawn';
export type EndpointMechanism = 'tcp_natmap' | 'udp_stun';
export type NetworkStateChangeSource =
  | 'ddns'
  | 'events'
  | 'reported'
  | 'status';

export type NetworkStateChangeEvent = {
  eventId: string;
  observedAt: string;
  source: NetworkStateChangeSource;
};

export type NetworkDdnsRecordType = 'A' | 'AAAA';
export type NetworkDdnsSourceType =
  | 'agent_ipv6'
  | 'port_forward_ip4p'
  | 'port_forward_ipv4';
export type NetworkDdnsSyncStatus =
  | 'disabled'
  | 'failed'
  | 'pending'
  | 'synced'
  | 'syncing'
  | 'waiting_source';

export type NetworkDdnsRecordInput = {
  domain: string;
  enabled: boolean;
  name: string;
  portForwardId?: string;
  recordType: NetworkDdnsRecordType;
  remark?: string;
  sourceType: NetworkDdnsSourceType;
  subDomain: string;
};

export type NetworkDdnsRecordUpdateInput = Partial<NetworkDdnsRecordInput>;

export type NetworkDdnsListQuery = {
  enabled?: boolean;
  name?: string;
  pageNo?: number;
  pageSize?: number;
  recordType?: NetworkDdnsRecordType;
  syncStatus?: NetworkDdnsSyncStatus;
};

export type NetworkDdnsSourceOption = {
  currentAddress: null | string;
  currentPort?: number;
  disabledReasonCode: null | string;
  eligible: boolean;
  externalPort?: number;
  groupId?: string;
  id: string;
  mechanism?: EndpointMechanism;
  name: string;
  observedAt: null | KtDateTime;
  protocol?: PortForwardProtocol;
  sourceType: NetworkDdnsSourceType;
  validUntil: null | KtDateTime;
};

export type NetworkDesiredMapping = {
  externalPort: number;
  id: string;
  internalPort: number;
  keeperDesiredEnabled: boolean;
  name: string;
  probeRequestId?: string;
  protocol: PortForwardProtocol;
  state: DesiredPresence;
  targetIpv4: string;
};

export type NetworkDesiredSnapshot = {
  agentId: string;
  issuedAt: string;
  mappings: NetworkDesiredMapping[];
  revision: number;
  schemaVersion: typeof NETWORK_AGENT_SCHEMA_VERSION;
  targetIpv4: string;
};

export type NetworkEndpointLease = {
  observedAt: string;
  publicIpv4: string;
  publicPort: number;
  validUntil: string;
};

export type NetworkReportedMapping = {
  currentEndpoint?: NetworkEndpointLease;
  desiredState: DesiredPresence;
  errorCode?: string;
  errorMessage?: string;
  id: string;
  keeperDesiredEnabled: boolean;
  keeperStatus: KeeperStatus;
  lastObservedEndpoint?: NetworkEndpointLease;
  lastProbeRequestId?: string;
  revision: number;
  routePresent: boolean;
  routerPresent: boolean;
  syncStatus: PortForwardSyncStatus;
};

export type NetworkReportedSnapshot = {
  agentId: string;
  appliedRevision: number;
  desiredDigest: string;
  helperAppliedRevision: number;
  helperDigest: string;
  helperStatus: HelperStatus;
  mappings: NetworkReportedMapping[];
  reportedAt: string;
  schemaVersion: typeof NETWORK_AGENT_SCHEMA_VERSION;
};

export type NetworkStatusSnapshot = {
  agentId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  observedAt: string;
  online: boolean;
  publicIpv6?: string | null;
  schemaVersion: typeof NETWORK_AGENT_SCHEMA_VERSION;
  startedAt?: string | null;
  version?: string | null;
};

export type NetworkEndpointEvent = {
  agentId: string;
  endpoint: NetworkEndpointLease;
  eventId: string;
  mappingId: string;
  occurredAt: string;
  reason?: string;
  revision: number;
  schemaVersion: typeof NETWORK_AGENT_SCHEMA_VERSION;
  type: EndpointEventType;
};

export class NetworkMessageValidationError extends Error {}

/**
 * 根据`state`、`mappings`构造期望的快照。
 * @param state - 用于期望的快照的领域对象，包含 `agentId`、`desiredRevision`、`desiredIssuedAt`、`targetIpv4` 字段。
 * @param mappings - 用于期望的快照的领域对象，包含 `length` 字段。
 * @returns 包含 `schemaVersion`、`agentId`、`revision`、`issuedAt`、`targetIpv4` 字段的期望的快照。
 */
export function buildDesiredSnapshot(
  state: NetworkAgentState,
  mappings: NetworkPortForward[],
): NetworkDesiredSnapshot {
  if (mappings.length > NETWORK_AGENT_MAX_MAPPINGS) {
    invalid('desired mapping count');
  }
  return {
    schemaVersion: NETWORK_AGENT_SCHEMA_VERSION,
    agentId: state.agentId,
    revision: toSafeRevision(state.desiredRevision, 'desiredRevision'),
    issuedAt: toIsoString(state.desiredIssuedAt),
    targetIpv4: state.targetIpv4,
    mappings: [...mappings]
      .sort((left, right) => compareIds(left.id, right.id))
      .map((mapping) => ({
        id: String(mapping.id),
        name: mapping.name,
        protocol: mapping.protocol,
        externalPort: mapping.externalPort,
        internalPort: mapping.internalPort,
        targetIpv4: mapping.targetIpv4,
        state: mapping.desiredPresence,
        keeperDesiredEnabled: mapping.keeperDesiredEnabled,
        ...(() => {
          if (mapping.probeRequestId) {
            return { probeRequestId: mapping.probeRequestId };
          }
          return {};
        })(),
      })),
  };
}

/**
 * 把网络期望快照按 JSON UTF-8 编码为 Buffer，作为摘要和发布时的稳定字节表示。
 * @param snapshot - 决定desired快照Bytes内容、边界或目标的 `snapshot` 值。
 * @returns 返回网络期望快照 JSON 的 UTF-8 Buffer。
 */
export function desiredSnapshotBytes(snapshot: NetworkDesiredSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot), 'utf8');
}

/**
 * 按规范字段顺序计算期望的快照摘要。
 * @param snapshot - 用于按规范字段顺序计算期望的快照摘要的领域对象，包含 `mappings`、`schemaVersion`、`agentId`、`targetIpv4` 字段。
 * @returns 按规范字段顺序计算期望的快照摘要。
 */
export function desiredSnapshotDigest(
  snapshot: NetworkDesiredSnapshot,
): string {
  const mappings = [...snapshot.mappings]
    .sort((left, right) => {
      const id = compareStrings(left.id, right.id);
      if (id !== 0) return id;
      const protocol = compareStrings(left.protocol, right.protocol);
      if (protocol !== 0) {
        return protocol;
      }
      return left.externalPort - right.externalPort;
    })
    .map((mapping) => ({
      id: mapping.id,
      name: mapping.name,
      protocol: mapping.protocol,
      externalPort: mapping.externalPort,
      internalPort: mapping.internalPort,
      targetIpv4: mapping.targetIpv4,
      state: mapping.state,
      keeperDesiredEnabled: mapping.keeperDesiredEnabled,
      ...(() => {
        if (mapping.probeRequestId) {
          return { probeRequestId: mapping.probeRequestId };
        }
        return {};
      })(),
    }));
  return createHash('sha256')
    .update(
      goJsonStringify({
        schemaVersion: snapshot.schemaVersion,
        agentId: snapshot.agentId,
        targetIpv4: snapshot.targetIpv4,
        mappings,
      }),
    )
    .digest('hex');
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
 * 从`value`解析已报告的快照；先通过 `assertSchema` 校验输入边界。
 * @param value - 待转换为已报告的快照的原始值。
 * @returns 包含 `agentId`、`appliedRevision`、`desiredDigest`、`helperAppliedRevision`、`helperDigest` 字段的已报告的快照。
 */
export function parseReportedSnapshot(value: unknown): NetworkReportedSnapshot {
  const record = exactRecord(
    value,
    [
      'agentId',
      'appliedRevision',
      'desiredDigest',
      'helperAppliedRevision',
      'helperDigest',
      'helperStatus',
      'mappings',
      'reportedAt',
      'schemaVersion',
    ],
    [],
    'reported',
  );
  assertSchema(record.schemaVersion);
  const appliedRevision = positiveRevision(
    record.appliedRevision,
    'appliedRevision',
  );
  const reportedAt = isoString(record.reportedAt, 'reportedAt');
  const helperStatus = enumValue(
    record.helperStatus,
    ['confirmed', 'failed', 'unknown'] as const,
    'helperStatus',
  );
  const helperAppliedRevision = safeRevision(
    record.helperAppliedRevision,
    'helperAppliedRevision',
  );
  const helperDigest = stringValue(
    record.helperDigest,
    'helperDigest',
    64,
    true,
  );
  validateHelperState(helperStatus, helperAppliedRevision, helperDigest);
  if (!Array.isArray(record.mappings)) invalid('reported.mappings');
  if (record.mappings.length > NETWORK_AGENT_MAX_MAPPINGS) {
    invalid('reported.mappings');
  }
  const mappings = record.mappings.map((mapping, index) =>
    parseReportedMapping(mapping, index, appliedRevision, reportedAt),
  );
  if (new Set(mappings.map((mapping) => mapping.id)).size !== mappings.length) {
    invalid('reported mapping duplicate');
  }
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    appliedRevision,
    desiredDigest: digest(record.desiredDigest, 'desiredDigest'),
    helperAppliedRevision,
    helperDigest,
    helperStatus,
    mappings,
    reportedAt,
    schemaVersion: NETWORK_AGENT_SCHEMA_VERSION,
  };
}

/**
 * 从`value`解析状态快照；先通过 `assertSchema` 校验输入边界。
 * @param value - 待转换为状态快照的原始值。
 * @returns 包含 `agentId`、`errorCode`、`errorMessage`、`observedAt`、`online` 字段的状态快照。
 */
export function parseStatusSnapshot(value: unknown): NetworkStatusSnapshot {
  const record = exactRecord(
    value,
    ['agentId', 'observedAt', 'online', 'schemaVersion'],
    ['errorCode', 'errorMessage', 'publicIpv6', 'startedAt', 'version'],
    'status',
  );
  assertSchema(record.schemaVersion);
  if (typeof record.online !== 'boolean') invalid('status.online');
  const publicIpv6 = optionalGlobalIpv6(record.publicIpv6, 'status.publicIpv6');
  if (!record.online && publicIpv6) invalid('status.publicIpv6');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    errorCode: optionalString(record.errorCode, 'errorCode', 64),
    errorMessage: optionalString(record.errorMessage, 'errorMessage', 500),
    observedAt: isoString(record.observedAt, 'observedAt'),
    online: record.online,
    publicIpv6,
    schemaVersion: NETWORK_AGENT_SCHEMA_VERSION,
    startedAt: optionalIsoString(record.startedAt, 'startedAt'),
    version: optionalString(record.version, 'version', 64),
  };
}

/**
 * 根据`value`、`label`处理输入约束并返回可选的全局IPv6。
 * @param value - 参与输入约束并返回可选的全局IPv6比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回可选的全局IPv6内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回可选的全局IPv6；没有可用结果或提前结束时为 `undefined`。
 */
function optionalGlobalIpv6(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || isIP(value) !== 6) invalid(label);
  let normalized: string;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    normalized = hostname.slice(1, -1).toLowerCase();
  } catch {
    invalid(label);
  }
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  if (
    !Number.isInteger(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff
  ) {
    invalid(label);
  }
  return normalized;
}

/**
 * 从`value`解析端点事件；先通过 `assertSchema` 校验输入边界。
 * @param value - 待转换为端点事件的原始值。
 * @returns 包含 `agentId`、`endpoint`、`eventId`、`mappingId`、`occurredAt` 字段的端点事件。
 */
export function parseEndpointEvent(value: unknown): NetworkEndpointEvent {
  const record = exactRecord(
    value,
    [
      'agentId',
      'endpoint',
      'eventId',
      'mappingId',
      'occurredAt',
      'revision',
      'schemaVersion',
      'type',
    ],
    ['reason'],
    'event',
  );
  assertSchema(record.schemaVersion);
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    endpoint: parseEndpointLease(record.endpoint, 'event.endpoint'),
    eventId: requestId(record.eventId, 'eventId'),
    mappingId: idString(record.mappingId, 'mappingId'),
    occurredAt: isoString(record.occurredAt, 'occurredAt'),
    reason: optionalString(record.reason, 'reason', 128) || undefined,
    revision: positiveRevision(record.revision, 'revision'),
    schemaVersion: NETWORK_AGENT_SCHEMA_VERSION,
    type: enumValue(
      record.type,
      ['changed', 'published', 'restored', 'withdrawn'] as const,
      'event.type',
    ),
  };
}

/**
 * 根据`value`与当前约束判定IPv4地址。
 * @param value - 待判定是否满足IPv4地址约束的候选值。
 * @returns 满足IPv4地址约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const octet = Number(part);
      return octet >= 0 && octet <= 255 && `${octet}` === part;
    })
  );
}

/**
 * 根据`protocol`、`externalPort`拼接稳定的端口转发启用的键，用于隔离对应资源或存储记录。
 * @param protocol - 决定端口转发启用的键内容、边界或目标的 `protocol` 值。
 * @param externalPort - 决定端口转发启用的键内容、边界或目标的 `externalPort` 值。
 * @returns 按参数编码并拼接完成的端口转发启用的键。
 */
export function portForwardActiveKey(
  protocol: PortForwardProtocol,
  externalPort: number,
): string {
  return `${protocol}:${externalPort}`;
}

/**
 * 从`value`、`index`、`appliedRevision`解析已报告的映射；从 `getTime` 读取已报告的映射。
 * @param value - 待转换为已报告的映射的原始值。
 * @param index - 指定已报告的映射在集合或布局中的零基位置。
 * @param appliedRevision - 决定已报告的映射内容、边界或目标的 `appliedRevision` 值。
 * @param reportedAt - 用于过期、排序或租约判定的时间基准。
 * @returns 包含 `currentEndpoint`、`desiredState`、`errorCode`、`errorMessage`、`id` 字段的已报告的映射；没有可用结果或提前结束时为 `undefined`。
 */
function parseReportedMapping(
  value: unknown,
  index: number,
  appliedRevision: number,
  reportedAt: string,
): NetworkReportedMapping {
  const record = exactRecord(
    value,
    [
      'desiredState',
      'id',
      'keeperDesiredEnabled',
      'keeperStatus',
      'revision',
      'routePresent',
      'routerPresent',
      'syncStatus',
    ],
    [
      'currentEndpoint',
      'errorCode',
      'errorMessage',
      'lastObservedEndpoint',
      'lastProbeRequestId',
    ],
    `reported.mappings[${index}]`,
  );
  const revision = positiveRevision(record.revision, 'mapping.revision');
  if (revision !== appliedRevision) invalid('mapping.revision');
  if (
    typeof record.routerPresent !== 'boolean' ||
    typeof record.routePresent !== 'boolean' ||
    typeof record.keeperDesiredEnabled !== 'boolean'
  ) {
    invalid('mapping booleans');
  }
  const desiredState = enumValue(
    record.desiredState,
    ['absent', 'present'] as const,
    'desiredState',
  );
  const syncStatus = enumValue(
    record.syncStatus,
    ['conflict', 'deleting', 'failed', 'pending', 'synced', 'syncing'] as const,
    'syncStatus',
  );
  const keeperStatus = enumValue(
    record.keeperStatus,
    ['active', 'disabled', 'failed', 'stale', 'starting'] as const,
    'keeperStatus',
  );
  const currentEndpoint = optionalEndpointLease(
    record.currentEndpoint,
    'currentEndpoint',
  );
  const lastObservedEndpoint = optionalEndpointLease(
    record.lastObservedEndpoint,
    'lastObservedEndpoint',
  );
  if (
    currentEndpoint &&
    (!lastObservedEndpoint ||
      !record.keeperDesiredEnabled ||
      new Date(currentEndpoint.validUntil).getTime() <=
        new Date(reportedAt).getTime())
  ) {
    invalid('current endpoint evidence');
  }
  if (desiredState === 'absent' && syncStatus === 'synced') {
    if (
      record.routerPresent ||
      record.routePresent ||
      record.keeperDesiredEnabled
    ) {
      invalid('absent deletion evidence');
    }
    if (keeperStatus !== 'disabled' || currentEndpoint) {
      invalid('absent deletion evidence');
    }
  }
  if (
    desiredState === 'present' &&
    syncStatus === 'synced' &&
    (!record.routerPresent || !record.routePresent)
  ) {
    invalid('present route evidence');
  }
  const errorCode = optionalString(record.errorCode, 'errorCode', 64);
  if (errorCode && !/^[a-z0-9_]{1,64}$/.test(errorCode)) {
    invalid('errorCode');
  }
  return {
    currentEndpoint,
    desiredState,
    errorCode: errorCode || undefined,
    errorMessage:
      optionalString(record.errorMessage, 'errorMessage', 512) || undefined,
    id: idString(record.id, 'mapping.id'),
    keeperDesiredEnabled: record.keeperDesiredEnabled,
    keeperStatus,
    lastObservedEndpoint,
    lastProbeRequestId:
      optionalRequestId(record.lastProbeRequestId, 'lastProbeRequestId') ||
      undefined,
    revision,
    routePresent: record.routePresent,
    routerPresent: record.routerPresent,
    syncStatus,
  };
}

/**
 * 从`value`、`label`解析端点租约；从 `getTime` 读取端点租约。
 * @param value - 待转换为端点租约的原始值。
 * @param label - 决定端点租约内容、边界或目标的 `label` 值。
 * @returns 包含 `observedAt`、`publicIpv4`、`publicPort`、`validUntil` 字段的端点租约。
 */
function parseEndpointLease(
  value: unknown,
  label: string,
): NetworkEndpointLease {
  const record = exactRecord(
    value,
    ['observedAt', 'publicIpv4', 'publicPort', 'validUntil'],
    [],
    label,
  );
  const observedAt = isoString(record.observedAt, `${label}.observedAt`);
  const validUntil = isoString(record.validUntil, `${label}.validUntil`);
  if (new Date(validUntil).getTime() <= new Date(observedAt).getTime()) {
    invalid(`${label}.validUntil`);
  }
  const publicIpv4 = ipv4(record.publicIpv4, `${label}.publicIpv4`);
  if (!isPublicIpv4(publicIpv4)) invalid(`${label}.publicIpv4`);
  return {
    observedAt,
    publicIpv4,
    publicPort: port(record.publicPort, `${label}.publicPort`),
    validUntil,
  };
}

/**
 * 保留空值并规范化可选的端点租约。
 * @param value - 参与保留空值并规范化可选的端点租约比较、格式化或输出的候选值。
 * @param label - 决定保留空值并规范化可选的端点租约内容、边界或目标的 `label` 值。
 * @returns 保留空值并规范化可选的端点租约；没有可用结果或提前结束时为 `undefined`。
 */
function optionalEndpointLease(
  value: unknown,
  label: string,
): NetworkEndpointLease | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseEndpointLease(value, label);
}

/**
 * 校验`status`、`revision`、`helperDigest`是否满足辅助器状态约束，并拒绝不合法输入。
 * @param status - 决定辅助器状态内容、边界或目标的 `status` 值。
 * @param revision - 决定辅助器状态内容、边界或目标的 `revision` 值。
 * @param helperDigest - 决定辅助器状态内容、边界或目标的 `helperDigest` 值。
 */
function validateHelperState(
  status: HelperStatus,
  revision: number,
  helperDigest: string,
): void {
  if (status === 'confirmed' && (revision === 0 || !isDigest(helperDigest))) {
    invalid('confirmed helper state');
  }
  if (
    status === 'failed' &&
    !(
      (revision === 0 && helperDigest === '') ||
      (revision > 0 && isDigest(helperDigest))
    )
  ) {
    invalid('failed helper state');
  }
  if (status === 'unknown' && (revision !== 0 || helperDigest !== '')) {
    invalid('unknown helper state');
  }
}

/**
 * 根据`value`、`required`、`optional`处理输入约束并返回精确记录。
 * @param value - 参与输入约束并返回精确记录比较、格式化或输出的候选值。
 * @param required - 决定是否启用“required”分支的布尔选项。
 * @param optional - 决定输入约束并返回精确记录内容、边界或目标的 `optional` 值。
 * @param label - 决定输入约束并返回精确记录内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回精确记录。
 */
function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(label);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    invalid(label);
  }
  return record;
}

/**
 * 根据字段标签构造并抛出网络消息校验异常，使所有协议解析失败保持统一错误边界。
 * @param label - 用于错误定位的字段标签；插入模板文本以形成稳定标识或路径。
 * @throws 调用该字段校验拒绝函数时抛出对应网络消息校验异常，并在消息中包含字段名称。
 */
function invalid(label: string): never {
  throw new NetworkMessageValidationError(`Invalid network message: ${label}`);
}

/**
 * 要求网络 Agent v1 载荷声明固定协议版本，版本不匹配时进入统一字段校验失败边界。
 * @param value - 载荷中待核对的 `schemaVersion` 字段值。
 */
function assertSchema(value: unknown): void {
  if (value !== NETWORK_AGENT_SCHEMA_VERSION) invalid('schemaVersion');
}

/**
 * 根据`value`、`label`、`max`处理输入约束并返回有界的字符串。
 * @param value - 参与输入约束并返回有界的字符串比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回有界的字符串内容、边界或目标的 `label` 值。
 * @param max - 决定输入约束并返回有界的字符串内容、边界或目标的 `max` 值。
 * @returns 输入约束并返回有界的字符串。
 */
function boundedString(value: unknown, label: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    Buffer.byteLength(value, 'utf8') > max
  ) {
    invalid(label);
  }
  return value;
}

/**
 * 要求协议字段为不超出 UTF-8 字节上限的字符串，并按调用方规则决定是否接受空串。
 * @param value - 待验证类型、长度与空值规则的协议字段值。
 * @param label - 字段校验失败时写入异常的协议字段标签。
 * @param max - 允许的最大 UTF-8 字节数。
 * @param allowEmpty - 是否允许空字符串通过校验。
 * @returns 保持内容不变的已验证字符串。
 */
function stringValue(
  value: unknown,
  label: string,
  max: number,
  allowEmpty: boolean,
): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > max ||
    (!allowEmpty && !value)
  ) {
    invalid(label);
  }
  return value;
}

/**
 * 保留空值并规范化可选的字符串。
 * @param value - 参与保留空值并规范化可选的字符串比较、格式化或输出的候选值。
 * @param label - 决定保留空值并规范化可选的字符串内容、边界或目标的 `label` 值。
 * @param max - 决定保留空值并规范化可选的字符串内容、边界或目标的 `max` 值。
 * @returns 保留空值并规范化可选的字符串；无法解析或未命中时为 `null`，没有可用结果或提前结束时为 `undefined`。
 */
function optionalString(
  value: unknown,
  label: string,
  max: number,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  return stringValue(value, label, max, true);
}

/**
 * 根据`value`、`label`处理输入约束并返回标识字符串。
 * @param value - 参与输入约束并返回标识字符串比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回标识字符串内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回标识字符串。
 */
function idString(value: unknown, label: string): string {
  const text = boundedString(value, label, 32);
  if (!/^\d{1,32}$/.test(text)) invalid(label);
  return text;
}

/**
 * 将兼容协议字段校验为不超过 128 字符且只含字母、数字、下划线或连字符的请求标识。
 * @param value - 参与标识比较、格式化或输出的候选值。
 * @param label - 决定标识内容、边界或目标的 `label` 值。
 * @returns 标识。
 */
function requestId(value: unknown, label: string): string {
  const text = boundedString(value, label, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) invalid(label);
  return text;
}

/**
 * 保留空值并规范化可选的请求标识。
 * @param value - 参与保留空值并规范化可选的请求标识比较、格式化或输出的候选值。
 * @param label - 决定保留空值并规范化可选的请求标识内容、边界或目标的 `label` 值。
 * @returns 保留空值并规范化可选的请求标识；没有可用结果或提前结束时为 `undefined`。
 */
function optionalRequestId(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requestId(value, label);
}

/**
 * 按当前约束判定ISO字符串。
 * @param value - 待判定是否满足ISO字符串约束的候选值。
 * @param label - 决定ISO字符串内容、边界或目标的 `label` 值。
 * @returns 满足ISO字符串约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isoString(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(label);
  const match = RFC3339_NANO_PATTERN.exec(value);
  if (!match) invalid(label);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12) invalid(label);
  if (day < 1 || day > daysInMonth(year, month)) invalid(label);
  if (hour > 23 || minute > 59 || second > 59) invalid(label);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(label);
  return value;
}

/**
 * 根据`year`、`month`处理指定月份的天数；当 `month === 2` 成立时返回 `29`。
 * @param year - 决定指定月份的天数内容、边界或目标的 `year` 值。
 * @param month - 决定指定月份的天数内容、边界或目标的 `month` 值。
 * @returns 当前状态对应的指定月份的天数，取值为 `29`、`28`、`30`、`31`。
 */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (leap) {
      return 29;
    }
    return 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

/**
 * 保留空值并规范化可选的ISO字符串。
 * @param value - 参与保留空值并规范化可选的ISO字符串比较、格式化或输出的候选值。
 * @param label - 决定保留空值并规范化可选的ISO字符串内容、边界或目标的 `label` 值。
 * @returns 保留空值并规范化可选的ISO字符串；无法解析或未命中时为 `null`，没有可用结果或提前结束时为 `undefined`。
 */
function optionalIsoString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  return isoString(value, label);
}

/**
 * 根据`value`、`label`处理输入约束并返回安全版本。
 * @param value - 参与输入约束并返回安全版本比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回安全版本内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回安全版本。
 */
function safeRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(label);
  return Number(value);
}

/**
 * 根据`value`、`label`处理输入约束并返回正数版本。
 * @param value - 参与输入约束并返回正数版本比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回正数版本内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回正数版本。
 */
function positiveRevision(value: unknown, label: string): number {
  const revision = safeRevision(value, label);
  if (revision === 0) invalid(label);
  return revision;
}

/**
 * 将输入收敛并投影为安全版本。
 * @param value - 待转换为安全版本的原始值。
 * @param label - 决定安全版本内容、边界或目标的 `label` 值。
 * @returns 安全版本。
 */
function toSafeRevision(value: string, label: string): number {
  return positiveRevision(Number(value), label);
}

/**
 * 按协议约束校验端口为 1 至 65535 范围内的整数。
 * @param value - 待验证的协议端口值。
 * @param label - 端口校验失败时写入异常的协议字段标签。
 * @returns 保持数值不变的有效 TCP 或 UDP 端口。
 */
function port(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535) {
    invalid(label);
  }
  return Number(value);
}

/**
 * 根据`value`、`label`处理输入约束并返回IPv4。
 * @param value - 参与输入约束并返回IPv4比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回IPv4内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回IPv4。
 */
function ipv4(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isIpv4Address(value)) invalid(label);
  return value;
}

/**
 * 按协议约束校验字段为字符串且属于调用方给定的枚举成员集合。
 * @param value - 待匹配的协议枚举字段值。
 * @param allowed - 该协议字段允许采用的全部字符串成员。
 * @param label - 枚举校验失败时写入异常的协议字段标签。
 * @returns 已确认属于允许集合的枚举成员。
 */
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(label);
  }
  return value as T;
}

/**
 * 根据`value`、`label`处理输入约束并返回摘要。
 * @param value - 参与输入约束并返回摘要比较、格式化或输出的候选值。
 * @param label - 决定输入约束并返回摘要内容、边界或目标的 `label` 值。
 * @returns 输入约束并返回摘要。
 */
function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isDigest(value)) invalid(label);
  return value;
}

/**
 * 根据`value`与当前约束判定摘要。
 * @param value - 待判定是否满足摘要约束的候选值。
 * @returns 满足摘要约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * 根据`value`与当前约束判定公开的IPv4。
 * @param value - 待判定是否满足公开的IPv4约束的候选值。
 * @returns 满足公开的IPv4约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isPublicIpv4(value: string): boolean {
  const [a, b, c] = value.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/**
 * 将输入收敛并投影为ISO字符串。
 * @param value - 待转换为ISO字符串的原始值。
 * @returns ISO字符串。
 */
function toIsoString(value: Date | string): string {
  const date = (() => {
    if (value instanceof Date) {
      return value;
    }
    return new Date(value);
  })();
  if (Number.isNaN(date.getTime())) invalid('issuedAt');
  return date.toISOString();
}

/**
 * 根据`left`、`right`处理比较标识列表；当 `leftValue < rightValue` 成立时返回 `-1`。
 * @param left - 决定比较标识列表内容、边界或目标的 `left` 值。
 * @param right - 决定比较标识列表内容、边界或目标的 `right` 值。
 * @returns 当前状态对应的比较标识列表，取值为 `1`、`0`。
 */
function compareIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) {
    return -1;
  }
  if (leftValue > rightValue) {
    return 1;
  }
  return 0;
}

/**
 * 根据`left`、`right`处理比较字符串；当 `left < right` 成立时返回 `-1`。
 * @param left - 决定比较字符串内容、边界或目标的 `left` 值。
 * @param right - 决定比较字符串内容、边界或目标的 `right` 值。
 * @returns 当前状态对应的比较字符串，取值为 `1`、`0`。
 */
function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
