import { createHash } from 'node:crypto';
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

/** Permanent MQTT schema validation failure safe to acknowledge and drop. */
export class NetworkMessageValidationError extends Error {}

/**
 * Builds the exact Go schema-v1 desired snapshot with stable field and mapping order.
 * @param state - Persisted singleton Agent state.
 * @param mappings - Non-finalized mappings, including absent tombstones.
 * @returns Complete retained desired snapshot.
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
        ...(mapping.probeRequestId
          ? { probeRequestId: mapping.probeRequestId }
          : {}),
      })),
  };
}

/**
 * Serializes a desired snapshot into deterministic retained MQTT bytes.
 * @param snapshot - Snapshot returned by `buildDesiredSnapshot`.
 * @returns Stable UTF-8 JSON bytes.
 */
export function desiredSnapshotBytes(snapshot: NetworkDesiredSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot), 'utf8');
}

/**
 * Computes the exact Go canonical semantic digest, excluding revision and issue time.
 * @param snapshot - Complete desired snapshot.
 * @returns Lowercase hexadecimal SHA-256 digest accepted by the Agent contract.
 */
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

/** Serializes JSON with the additional HTML and line-separator escaping used by Go. */
function goJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Parses the exact Go schema-v1 full reported snapshot without coercion.
 * @param value - Untrusted MQTT JSON value.
 * @returns Strict reported snapshot safe for transactional consumption.
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
 * Parses the retained Agent liveness contract used by the runtime/LWT layer.
 * @param value - Untrusted MQTT JSON value.
 * @returns Strict liveness status independent from mapping state.
 */
export function parseStatusSnapshot(value: unknown): NetworkStatusSnapshot {
  const record = exactRecord(
    value,
    ['agentId', 'observedAt', 'online', 'schemaVersion'],
    ['errorCode', 'errorMessage', 'startedAt', 'version'],
    'status',
  );
  assertSchema(record.schemaVersion);
  if (typeof record.online !== 'boolean') invalid('status.online');
  return {
    agentId: boundedString(record.agentId, 'agentId', 64),
    errorCode: optionalString(record.errorCode, 'errorCode', 64),
    errorMessage: optionalString(record.errorMessage, 'errorMessage', 500),
    observedAt: isoString(record.observedAt, 'observedAt'),
    online: record.online,
    schemaVersion: NETWORK_AGENT_SCHEMA_VERSION,
    startedAt: optionalIsoString(record.startedAt, 'startedAt'),
    version: optionalString(record.version, 'version', 64),
  };
}

/**
 * Parses the exact Go schema-v1 append-only endpoint event.
 * @param value - Untrusted MQTT JSON value.
 * @returns Strict idempotent endpoint transition.
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
 * Validates a canonical IPv4 string without accepting octal-looking octets.
 * @param value - Untrusted address text.
 * @returns True only for four canonical decimal octets.
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
 * Produces the nullable-unique active key for one protocol and WAN port.
 * @param protocol - TCP or UDP desired protocol.
 * @param externalPort - WAN-side port.
 * @returns Stable database key.
 */
export function portForwardActiveKey(
  protocol: PortForwardProtocol,
  externalPort: number,
): string {
  return `${protocol}:${externalPort}`;
}

/** Parses one mapping using the exact Go MappingReport contract. */
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

/** Parses a required endpoint lease and mirrors Go public-address checks. */
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

/** Parses an omitted-or-present endpoint lease from Go `omitempty` fields. */
function optionalEndpointLease(
  value: unknown,
  label: string,
): NetworkEndpointLease | undefined {
  return value === undefined ? undefined : parseEndpointLease(value, label);
}

/** Validates the helper revision/digest invariants from Go schema-v1. */
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

/** Requires an object to contain all and only declared keys. */
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

/** Throws the stable validation error without including payload content. */
function invalid(label: string): never {
  throw new NetworkMessageValidationError(`Invalid network message: ${label}`);
}

/** Validates the one supported schema version. */
function assertSchema(value: unknown): void {
  if (value !== NETWORK_AGENT_SCHEMA_VERSION) invalid('schemaVersion');
}

/** Parses a bounded non-empty string. */
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

/** Parses a bounded optionally-empty string. */
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

/** Parses a nullable or omitted bounded string. */
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

/** Parses a decimal mapping ID. */
function idString(value: unknown, label: string): string {
  const text = boundedString(value, label, 32);
  if (!/^\d{1,32}$/.test(text)) invalid(label);
  return text;
}

/** Parses the Go request/event ID character contract. */
function requestId(value: unknown, label: string): string {
  const text = boundedString(value, label, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) invalid(label);
  return text;
}

/** Parses an omitted request ID. */
function optionalRequestId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requestId(value, label);
}

/** Parses the RFC3339Nano timestamps emitted by Go time.Time JSON. */
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

/** Returns the Gregorian day count for one validated year and month. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parses a nullable or omitted exact ISO timestamp. */
function optionalIsoString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  return isoString(value, label);
}

/** Parses a safe non-negative JSON revision. */
function safeRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(label);
  return Number(value);
}

/** Parses a safe positive JSON revision. */
function positiveRevision(value: unknown, label: string): number {
  const revision = safeRevision(value, label);
  if (revision === 0) invalid(label);
  return revision;
}

/** Converts a persisted bigint revision into the schema-v1 JSON number. */
function toSafeRevision(value: string, label: string): number {
  return positiveRevision(Number(value), label);
}

/** Parses an integer port without coercion. */
function port(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535) {
    invalid(label);
  }
  return Number(value);
}

/** Parses a canonical IPv4 address. */
function ipv4(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isIpv4Address(value)) invalid(label);
  return value;
}

/** Parses one fixed string enum. */
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

/** Parses one 64-character hexadecimal digest. */
function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isDigest(value)) invalid(label);
  return value;
}

/** Checks the Go canonical SHA-256 digest representation. */
function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Mirrors Go STUN public IPv4 exclusions for reported leases. */
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

/** Converts a TypeORM date value into exact ISO text. */
function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) invalid('issuedAt');
  return date.toISOString();
}

/** Sorts decimal IDs numerically without bigint precision loss. */
function compareIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

/** Compares ASCII contract identifiers without locale-dependent collation. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
