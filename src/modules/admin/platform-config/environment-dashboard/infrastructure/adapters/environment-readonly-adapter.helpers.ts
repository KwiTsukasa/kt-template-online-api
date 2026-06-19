import {
  errorEvidence,
  liveEvidence,
  unwiredEvidence,
} from '../environment-dashboard-evidence.mapper';
import type {
  EnvironmentHealthStatus,
  EnvironmentSignal,
} from '../../domain/environment-dashboard.types';

/**
 * Creates a standard unwired signal for readonly adapters without configuration.
 * @param id - Stable signal id exposed through dashboard topology.
 * @param label - Operator-facing integration label.
 * @param missingKeys - Public missing env/config keys.
 * @returns Environment signal with explicit unwired evidence.
 */
export function createUnwiredAdapterSignal(
  id: string,
  label: string,
  missingKeys: string[],
): EnvironmentSignal {
  return {
    evidence: [unwiredEvidence(label, missingKeys)],
    id,
    label,
    sourceKind: 'unwired',
    status: 'unwired',
    summary: '只读观测配置未接入',
  };
}

/**
 * Creates a dashboard signal from successful readonly remote evidence.
 * @param id - Stable signal id exposed through dashboard topology.
 * @param label - Operator-facing integration label.
 * @param summary - Short sanitized live probe summary.
 * @param metadata - Non-secret structured evidence extracted from the probe.
 * @param status - Dashboard status derived from the live probe response.
 * @param observedAt - Optional timestamp from the remote client response.
 * @returns Environment signal backed by live evidence.
 */
export function createLiveAdapterSignal(
  id: string,
  label: string,
  summary: string,
  metadata: Record<string, unknown> = {},
  status: EnvironmentHealthStatus = 'ok',
  observedAt?: Date | number | string,
): EnvironmentSignal {
  const evidence = liveEvidence(label, summary, observedAt, metadata);
  return {
    evidence: [evidence],
    id,
    label,
    observedAt: evidence.observedAt,
    sourceKind: 'live',
    status,
    summary,
  };
}

/**
 * Creates a dashboard signal from a failed configured readonly probe.
 * @param id - Stable signal id exposed through dashboard topology.
 * @param label - Operator-facing integration label.
 * @param error - Unknown exception or rejection reason from the probe.
 * @returns Degraded signal with sanitized error evidence.
 */
export function createErrorAdapterSignal(
  id: string,
  label: string,
  error: unknown,
): EnvironmentSignal {
  const evidence = errorEvidence(label, error);
  return {
    evidence: [evidence],
    id,
    label,
    observedAt: evidence.observedAt,
    sourceKind: 'derived',
    status: 'degraded',
    summary: evidence.summary,
  };
}

/**
 * Checks whether an HTTP status code is a successful readonly observation.
 * @param status - HTTP status code returned by the readonly client.
 * @returns True when the status is a 2xx or 3xx response.
 */
export function isReadonlyHttpOk(status: number): boolean {
  return status >= 200 && status < 400;
}

/**
 * Joins a configured readonly base URL with a relative API path.
 * @param baseUrl - Runtime configured URL without secrets.
 * @param path - Relative or absolute path segment for a readonly API endpoint.
 * @returns Fully qualified URL with duplicate separators normalized by URL.
 */
export function joinReadonlyUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

/**
 * Parses the bounded body preview returned by EnvironmentReadonlyHttpClient.
 * @param bodyPreview - Sanitized body preview from a readonly HTTP response.
 * @returns Parsed JSON object or an empty object when the preview is absent or not JSON.
 */
export function parseJsonPreview(
  bodyPreview: string,
): Record<string, unknown> {
  if (!bodyPreview) return {};
  try {
    const parsed = JSON.parse(bodyPreview);
    return asRecord(parsed) || {};
  } catch {
    return {};
  }
}

/**
 * Narrows an unknown value to a plain record for adapter metadata extraction.
 * @param value - Unknown JSON field or SDK payload.
 * @returns Record value when it is object-like and not an array.
 */
export function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Narrows an unknown value to an array for adapter metadata extraction.
 * @param value - Unknown JSON field or SDK payload.
 * @returns Array value when the input is an array; otherwise an empty array.
 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Converts string-like or numeric fields into safe summary strings.
 * @param value - Unknown JSON field or SDK payload.
 * @returns String representation for primitive values, otherwise undefined.
 */
export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `${value}`;
  return undefined;
}

/**
 * Converts numeric JSON fields into numbers for status calculations.
 * @param value - Unknown JSON field or SDK payload.
 * @returns Finite number or undefined when the value is not numeric.
 */
export function asNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
