import {
  errorEvidence,
  liveEvidence,
  unwiredEvidence,
} from '../environment-dashboard-evidence.mapper';
import type {
  EnvironmentHealthStatus,
  EnvironmentSignal,
} from '../../domain/environment-dashboard.types';

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

export function isReadonlyHttpOk(status: number): boolean {
  return status >= 200 && status < 400;
}

export function joinReadonlyUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

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

export function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `${value}`;
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
