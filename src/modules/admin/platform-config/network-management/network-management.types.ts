import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { KtDateTime } from '@/common';
import type { NetworkAgentState } from './network-agent-state.entity';
import type { NetworkPortForward } from './network-management.entity';

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
export type NetworkDdnsSourceType = 'agent_ipv6' | 'port_forward_ipv4';
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
  disabledReasonCode: null | string;
  eligible: boolean;
  externalPort?: number;
  id: string;
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
        ...(mapping.probeRequestId
          ? { probeRequestId: mapping.probeRequestId }
          : {}),
      })),
  };
}

export function desiredSnapshotBytes(snapshot: NetworkDesiredSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot), 'utf8');
}

export function desiredSnapshotDigest(
  snapshot: NetworkDesiredSnapshot,
): string {
  const mappings = [...snapshot.mappings]
    .sort((left, right) => {
      const id = compareStrings(left.id, right.id);
      if (id !== 0) return id;
      const protocol = compareStrings(left.protocol, right.protocol);
      return protocol !== 0 ? protocol : left.externalPort - right.externalPort;
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
      ...(mapping.probeRequestId
        ? { probeRequestId: mapping.probeRequestId }
        : {}),
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

function goJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

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

export function portForwardActiveKey(
  protocol: PortForwardProtocol,
  externalPort: number,
): string {
  return `${protocol}:${externalPort}`;
}

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
  if (
    desiredState === 'absent' &&
    syncStatus === 'synced' &&
    (record.routerPresent ||
      record.routePresent ||
      record.keeperDesiredEnabled ||
      keeperStatus !== 'disabled' ||
      currentEndpoint)
  ) {
    invalid('absent deletion evidence');
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

function optionalEndpointLease(
  value: unknown,
  label: string,
): NetworkEndpointLease | undefined {
  return value === undefined ? undefined : parseEndpointLease(value, label);
}

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

function invalid(label: string): never {
  throw new NetworkMessageValidationError(`Invalid network message: ${label}`);
}

function assertSchema(value: unknown): void {
  if (value !== NETWORK_AGENT_SCHEMA_VERSION) invalid('schemaVersion');
}

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

function idString(value: unknown, label: string): string {
  const text = boundedString(value, label, 32);
  if (!/^\d{1,32}$/.test(text)) invalid(label);
  return text;
}

function requestId(value: unknown, label: string): string {
  const text = boundedString(value, label, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) invalid(label);
  return text;
}

function optionalRequestId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requestId(value, label);
}

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
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    invalid(label);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(label);
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function optionalIsoString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  return isoString(value, label);
}

function safeRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(label);
  return Number(value);
}

function positiveRevision(value: unknown, label: string): number {
  const revision = safeRevision(value, label);
  if (revision === 0) invalid(label);
  return revision;
}

function toSafeRevision(value: string, label: string): number {
  return positiveRevision(Number(value), label);
}

function port(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535) {
    invalid(label);
  }
  return Number(value);
}

function ipv4(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isIpv4Address(value)) invalid(label);
  return value;
}

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

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isDigest(value)) invalid(label);
  return value;
}

function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isPublicIpv4(value: string): boolean {
  const [a, b, c] = value.split('.').map(Number);
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }
  return true;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) invalid('issuedAt');
  return date.toISOString();
}

function compareIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
