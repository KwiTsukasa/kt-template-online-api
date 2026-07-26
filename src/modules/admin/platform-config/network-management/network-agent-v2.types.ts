import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const NETWORK_AGENT_V2_SCHEMA_VERSION = 2 as const;
export const NETWORK_AGENT_V2_MAX_CHANNELS = 64;

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
export type NetworkV2EndpointMechanism = 'tcp_natmap' | 'udp_stun';
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
    });

export type NetworkDesiredSnapshotV2 = {
  agentId: string;
  channels: NetworkDesiredChannelV2[];
  issuedAt: string;
  schemaVersion: typeof NETWORK_AGENT_V2_SCHEMA_VERSION;
  snapshotDigest: string;
  snapshotRevision: number;
};

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
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function canonicalDesiredChannelDigestV2(
  channel: NetworkDesiredChannelV2,
): string {
  return digest(canonicalDesiredChannelV2(channel));
}

export function canonicalDesiredSnapshotDigestV2(
  snapshot: Pick<NetworkDesiredSnapshotV2, 'agentId' | 'channels' | 'schemaVersion'>,
): string {
  return digest({
    schemaVersion: snapshot.schemaVersion,
    agentId: snapshot.agentId,
    channels: [...snapshot.channels]
      .sort(compareDesiredChannelsV2)
      .map(canonicalDesiredChannelV2),
  });
}

export function parseDesiredSnapshotV2(value: unknown): NetworkDesiredSnapshotV2 {
  const record = exactRecord(
    value,
    ['agentId', 'channels', 'issuedAt', 'schemaVersion', 'snapshotDigest', 'snapshotRevision'],
    [],
    'desired',
  );
  assertSchema(record.schemaVersion);
  if (!Array.isArray(record.channels) || record.channels.length > NETWORK_AGENT_V2_MAX_CHANNELS) invalid('desired.channels');
  const channels = record.channels.map(parseDesiredChannelV2);
  if (new Set(channels.map((channel) => channel.channelId)).size !== channels.length) invalid('desired duplicate channel');
  const snapshot: NetworkDesiredSnapshotV2 = {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channels,
    issuedAt: isoString(record.issuedAt, 'issuedAt'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    snapshotDigest: digestValue(record.snapshotDigest, 'snapshotDigest'),
    snapshotRevision: positiveRevision(record.snapshotRevision, 'snapshotRevision'),
  };
  if (canonicalDesiredSnapshotDigestV2(snapshot) !== snapshot.snapshotDigest) invalid('snapshotDigest');
  return snapshot;
}

export function parseReportedSnapshotV2(value: unknown): NetworkReportedSnapshotV2 {
  const record = exactRecord(value, ['agentId', 'channels', 'reportedAt', 'schemaVersion', 'snapshotDigest', 'snapshotRevision'], [], 'reported');
  assertSchema(record.schemaVersion);
  if (!Array.isArray(record.channels) || record.channels.length > NETWORK_AGENT_V2_MAX_CHANNELS) invalid('reported.channels');
  const channels = record.channels.map(parseReportedChannelV2);
  if (new Set(channels.map((channel) => channel.channelId)).size !== channels.length) invalid('reported duplicate channel');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channels,
    reportedAt: isoString(record.reportedAt, 'reportedAt'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    snapshotDigest: digestValue(record.snapshotDigest, 'snapshotDigest'),
    snapshotRevision: positiveRevision(record.snapshotRevision, 'snapshotRevision'),
  };
}

export function parseStatusSnapshotV2(value: unknown): NetworkStatusSnapshotV2 {
  const record = exactRecord(value, ['agentId', 'observedAt', 'online', 'schemaVersion', 'supportedSchemaVersions', 'tcpNatmapCapable'], ['errorCode', 'errorMessage', 'publicIpv6', 'startedAt', 'version'], 'status');
  assertSchema(record.schemaVersion);
  if (!Array.isArray(record.supportedSchemaVersions) || record.supportedSchemaVersions.length !== 2 || record.supportedSchemaVersions[0] !== 1 || record.supportedSchemaVersions[1] !== 2) invalid('supportedSchemaVersions');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    ...(record.errorCode === undefined ? {} : { errorCode: errorCode(record.errorCode, 'errorCode') }),
    ...(record.errorMessage === undefined ? {} : { errorMessage: boundedString(record.errorMessage, 'errorMessage', 512) }),
    observedAt: isoString(record.observedAt, 'observedAt'),
    online: booleanValue(record.online, 'online'),
    ...(record.publicIpv6 === undefined ? {} : { publicIpv6: publicIpv6(record.publicIpv6) }),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    ...(record.startedAt === undefined ? {} : { startedAt: isoString(record.startedAt, 'startedAt') }),
    supportedSchemaVersions: [1, 2],
    tcpNatmapCapable: booleanValue(record.tcpNatmapCapable, 'tcpNatmapCapable'),
    ...(record.version === undefined ? {} : { version: boundedString(record.version, 'version', 128) }),
  };
}

export function parseEndpointEventV2(value: unknown): NetworkEndpointEventV2 {
  const record = exactRecord(value, ['agentId', 'channelId', 'eventId', 'groupId', 'mechanism', 'occurredAt', 'protocol', 'revision', 'schemaVersion', 'type'], ['endpoint', 'reason'], 'event');
  assertSchema(record.schemaVersion);
  const protocol = enumValue(record.protocol, ['tcp', 'udp'] as const, 'protocol');
  const mechanism = enumValue(record.mechanism, ['tcp_natmap', 'udp_stun'] as const, 'mechanism');
  const type = enumValue(record.type, ['changed', 'published', 'restored', 'withdrawn'] as const, 'type');
  if ((protocol === 'tcp') !== (mechanism === 'tcp_natmap')) invalid('event mechanism');
  const endpoint = record.endpoint === undefined ? undefined : parseEndpointV2(record.endpoint, mechanism);
  if ((type === 'withdrawn') !== (endpoint === undefined)) invalid('event endpoint');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    channelId: identifier(record.channelId, 'channelId'),
    ...(endpoint === undefined ? {} : { endpoint }),
    eventId: requestId(record.eventId, 'eventId'),
    groupId: identifier(record.groupId, 'groupId'),
    mechanism,
    occurredAt: isoString(record.occurredAt, 'occurredAt'),
    protocol,
    ...(record.reason === undefined ? {} : { reason: boundedString(record.reason, 'reason', 128) }),
    revision: positiveRevision(record.revision, 'revision'),
    schemaVersion: NETWORK_AGENT_V2_SCHEMA_VERSION,
    type,
  };
}

function parseDesiredChannelV2(value: unknown): NetworkDesiredChannelV2 {
  const protocol = protocolOf(value, 'desired channel');
  const required = ['channelDesiredDigest', 'channelDesiredRevision', 'channelId', 'desiredPresence', 'externalPort', 'groupId', 'internalPort', 'name', 'protocol'];
  const record = exactRecord(value, protocol === 'tcp' ? [...required, 'natmapDesiredEnabled'] : [...required, 'keeperDesiredEnabled'], protocol === 'udp' ? ['probeRequestId'] : [], 'desired channel');
  const base = desiredBase(record);
  const channel = protocol === 'tcp'
    ? { ...base, natmapDesiredEnabled: booleanValue(record.natmapDesiredEnabled, 'natmapDesiredEnabled'), protocol }
    : { ...base, keeperDesiredEnabled: booleanValue(record.keeperDesiredEnabled, 'keeperDesiredEnabled'), ...(record.probeRequestId === undefined ? {} : { probeRequestId: requestId(record.probeRequestId, 'probeRequestId') }), protocol };
  if (canonicalDesiredChannelDigestV2(channel) !== channel.channelDesiredDigest) invalid('channelDesiredDigest');
  return channel;
}

function parseReportedChannelV2(value: unknown): NetworkReportedChannelV2 {
  const protocol = protocolOf(value, 'reported channel');
  const common = ['appliedDesiredDigest', 'appliedDesiredRevision', 'channelId', 'desiredPresence', 'groupId', 'protocol', 'routerPresent', 'syncStatus'];
  const record = exactRecord(value, protocol === 'tcp' ? [...common, 'dnatPresent', 'natmapDesiredEnabled', 'natmapStatus'] : [...common, 'keeperDesiredEnabled', 'keeperStatus', 'routePresent'], protocol === 'tcp' ? ['candidateEndpoint', 'currentEndpoint', 'errorCode', 'errorMessage', 'instanceGeneration', 'lastObservedEndpoint', 'natmapErrorCode', 'natmapErrorMessage'] : ['currentEndpoint', 'errorCode', 'errorMessage', 'keeperErrorCode', 'keeperErrorMessage', 'lastObservedEndpoint', 'lastProbeRequestId'], 'reported channel');
  const base: ReportedChannelBaseV2 = {
    appliedDesiredDigest: digestValue(record.appliedDesiredDigest, 'appliedDesiredDigest'),
    appliedDesiredRevision: positiveRevision(record.appliedDesiredRevision, 'appliedDesiredRevision'),
    channelId: identifier(record.channelId, 'channelId'),
    desiredPresence: enumValue(record.desiredPresence, ['absent', 'present'] as const, 'desiredPresence'),
    ...(record.errorCode === undefined ? {} : { errorCode: errorCode(record.errorCode, 'errorCode') }),
    ...(record.errorMessage === undefined ? {} : { errorMessage: boundedString(record.errorMessage, 'errorMessage', 512) }),
    groupId: identifier(record.groupId, 'groupId'), protocol,
    routerPresent: booleanValue(record.routerPresent, 'routerPresent'),
    syncStatus: enumValue(record.syncStatus, ['conflict', 'deleting', 'failed', 'pending', 'synced', 'syncing'] as const, 'syncStatus'),
  };
  if (protocol === 'tcp') return { ...base, candidateEndpoint: optionalEndpoint(record.candidateEndpoint, 'tcp_natmap'), currentEndpoint: optionalEndpoint(record.currentEndpoint, 'tcp_natmap'), dnatPresent: booleanValue(record.dnatPresent, 'dnatPresent'), instanceGeneration: optionalBounded(record.instanceGeneration, 'instanceGeneration', 128), lastObservedEndpoint: optionalEndpoint(record.lastObservedEndpoint, 'tcp_natmap'), natmapDesiredEnabled: booleanValue(record.natmapDesiredEnabled, 'natmapDesiredEnabled'), natmapErrorCode: optionalErrorCode(record.natmapErrorCode, 'natmapErrorCode'), natmapErrorMessage: optionalBounded(record.natmapErrorMessage, 'natmapErrorMessage', 512), natmapStatus: enumValue(record.natmapStatus, ['active', 'disabled', 'failed', 'stale', 'starting', 'stopping'] as const, 'natmapStatus'), protocol };
  return { ...base, currentEndpoint: optionalEndpoint(record.currentEndpoint, 'udp_stun'), keeperDesiredEnabled: booleanValue(record.keeperDesiredEnabled, 'keeperDesiredEnabled'), keeperErrorCode: optionalErrorCode(record.keeperErrorCode, 'keeperErrorCode'), keeperErrorMessage: optionalBounded(record.keeperErrorMessage, 'keeperErrorMessage', 512), keeperStatus: enumValue(record.keeperStatus, ['active', 'disabled', 'failed', 'stale', 'starting'] as const, 'keeperStatus'), lastObservedEndpoint: optionalEndpoint(record.lastObservedEndpoint, 'udp_stun'), lastProbeRequestId: record.lastProbeRequestId === undefined ? undefined : requestId(record.lastProbeRequestId, 'lastProbeRequestId'), protocol, routePresent: booleanValue(record.routePresent, 'routePresent') };
}

function desiredBase(record: Record<string, unknown>): DesiredChannelBaseV2 {
  return { channelDesiredDigest: digestValue(record.channelDesiredDigest, 'channelDesiredDigest'), channelDesiredRevision: positiveRevision(record.channelDesiredRevision, 'channelDesiredRevision'), channelId: identifier(record.channelId, 'channelId'), desiredPresence: enumValue(record.desiredPresence, ['absent', 'present'] as const, 'desiredPresence'), externalPort: port(record.externalPort, 'externalPort'), groupId: identifier(record.groupId, 'groupId'), internalPort: port(record.internalPort, 'internalPort'), name: boundedString(record.name, 'name', 128) };
}

function parseEndpointV2(value: unknown, expectedMechanism: NetworkV2EndpointMechanism): NetworkEndpointLeaseV2 {
  const record = exactRecord(value, ['mechanism', 'observedAt', 'publicIpv4', 'publicPort', 'validatedAt', 'validUntil'], [], 'endpoint');
  const mechanism = enumValue(record.mechanism, ['tcp_natmap', 'udp_stun'] as const, 'mechanism');
  if (mechanism !== expectedMechanism) invalid('endpoint mechanism');
  const observedAt = isoString(record.observedAt, 'observedAt');
  const validatedAt = isoString(record.validatedAt, 'validatedAt');
  const validUntil = isoString(record.validUntil, 'validUntil');
  if (Date.parse(validUntil) <= Date.parse(observedAt)) invalid('endpoint validity');
  return { mechanism, observedAt, publicIpv4: publicIpv4(record.publicIpv4), publicPort: port(record.publicPort, 'publicPort'), validatedAt, validUntil };
}

function canonicalDesiredChannelV2(channel: NetworkDesiredChannelV2): object {
  if (channel.protocol === 'tcp') return { channelId: channel.channelId, desiredPresence: channel.desiredPresence, externalPort: channel.externalPort, groupId: channel.groupId, internalPort: channel.internalPort, name: channel.name, natmapDesiredEnabled: channel.natmapDesiredEnabled, protocol: channel.protocol };
  return { channelId: channel.channelId, desiredPresence: channel.desiredPresence, externalPort: channel.externalPort, groupId: channel.groupId, internalPort: channel.internalPort, keeperDesiredEnabled: channel.keeperDesiredEnabled, name: channel.name, ...(channel.probeRequestId === undefined ? {} : { probeRequestId: channel.probeRequestId }), protocol: channel.protocol };
}

function compareDesiredChannelsV2(left: NetworkDesiredChannelV2, right: NetworkDesiredChannelV2): number { return (left.channelId < right.channelId ? -1 : left.channelId > right.channelId ? 1 : 0) || (left.protocol < right.protocol ? -1 : left.protocol > right.protocol ? 1 : 0) || left.externalPort - right.externalPort; }
function optionalEndpoint(value: unknown, mechanism: NetworkV2EndpointMechanism): NetworkEndpointLeaseV2 | undefined { return value === undefined ? undefined : parseEndpointV2(value, mechanism); }
function optionalBounded(value: unknown, name: string, max: number): string | undefined { return value === undefined ? undefined : boundedString(value, name, max); }
function optionalErrorCode(value: unknown, name: string): string | undefined { return value === undefined ? undefined : errorCode(value, name); }
function protocolOf(value: unknown, name: string): NetworkV2Protocol { if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(name); return enumValue((value as Record<string, unknown>).protocol, ['tcp', 'udp'] as const, 'protocol'); }
function exactRecord(value: unknown, required: string[], optional: string[], name: string, allowPartial = false): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(name); const record = value as Record<string, unknown>; const allowed = new Set([...required, ...optional]); if (Object.keys(record).some((key) => !allowed.has(key)) || (!allowPartial && required.some((key) => !(key in record)))) invalid(name); return record; }
function assertSchema(value: unknown): void { if (value !== NETWORK_AGENT_V2_SCHEMA_VERSION) invalid('schemaVersion'); }
function identifier(value: unknown, name: string): string { const result = stringValue(value, name, 32); if (!ID_PATTERN.test(result)) invalid(name); return result; }
function requestId(value: unknown, name: string): string { const result = stringValue(value, name, 128); if (!REQUEST_ID_PATTERN.test(result)) invalid(name); return result; }
function digestValue(value: unknown, name: string): string { const result = stringValue(value, name, 64); if (!/^[0-9a-f]{64}$/.test(result)) invalid(name); return result; }
function errorCode(value: unknown, name: string): string { const result = stringValue(value, name, 64); if (!ERROR_CODE_PATTERN.test(result)) invalid(name); return result; }
function boundedString(value: unknown, name: string, max: number): string { const result = stringValue(value, name, max); if (result.length === 0) invalid(name); return result; }
function stringValue(value: unknown, name: string, max: number): string { if (typeof value !== 'string' || value.length > max) invalid(name); return value; }
function positiveRevision(value: unknown, name: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid(name); return value; }
function port(value: unknown, name: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) invalid(name); return value; }
function booleanValue(value: unknown, name: string): boolean { if (typeof value !== 'boolean') invalid(name); return value; }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T { if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(name); return value as T; }
function isoString(value: unknown, name: string): string { const result = stringValue(value, name, 64); if (!RFC3339_PATTERN.test(result) || Number.isNaN(Date.parse(result))) invalid(name); return result; }
function publicIpv4(value: unknown): string { const result = stringValue(value, 'publicIpv4', 15); const [a, b, c] = result.split('.').map(Number); if (isIP(result) !== 4 || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) invalid('publicIpv4'); return result; }
function publicIpv6(value: unknown): string { const result = stringValue(value, 'publicIpv6', 45); if (isIP(result) !== 6 || /^(::1|::|fc|fd|fe[89ab]|ff)/i.test(result)) invalid('publicIpv6'); return result.toLowerCase().replace(/(^|:)0+([0-9a-f])/g, '$1$2'); }
function digest(value: unknown): string { return createHash('sha256').update(goJsonStringify(value)).digest('hex'); }
function goJsonStringify(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function invalid(name: string): never { throw new NetworkV2MessageValidationError(`invalid network v2 ${name}`); }
