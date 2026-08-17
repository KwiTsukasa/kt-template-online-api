import type { EnvironmentEvidence } from '../domain/environment-dashboard.types';
import { normalizeObservedAt } from '../application/environment-dashboard-status.mapper';

/** 返回实时证据。 */
export function liveEvidence(
  source: string,
  summary: string,
  observedAt?: Date | number | string,
  metadata?: Record<string, unknown>,
): EnvironmentEvidence {
  return {
    metadata,
    observedAt: normalizeObservedAt(observedAt),
    source,
    sourceKind: 'live',
    summary,
  };
}

/** 返回未接线的证据。 */
export function unwiredEvidence(
  source: string,
  missingConfigKeys: string[],
  documentationPath?: string,
): EnvironmentEvidence {
  return {
    metadata: {
      documentationPath,
      missingConfigKeys,
    },
    observedAt: normalizeObservedAt(),
    source,
    sourceKind: 'unwired',
    summary:
      missingConfigKeys.length > 0
        ? `缺少只读观测配置：${missingConfigKeys.join(', ')}`
        : '只读观测入口尚未接入',
  };
}

/** 返回错误证据。 */
export function errorEvidence(
  source: string,
  error: unknown,
  observedAt?: Date | number | string,
): EnvironmentEvidence {
  const summary =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '只读观测失败';

  return {
    observedAt: normalizeObservedAt(observedAt),
    source,
    sourceKind: 'derived',
    summary,
  };
}

/** 返回已缓存的证据。 */
export function cachedEvidence(
  source: string,
  summary: string,
  observedAt: Date | number | string,
  expiresAt: Date | number | string,
): EnvironmentEvidence {
  return {
    expiresAt: normalizeObservedAt(expiresAt),
    observedAt: normalizeObservedAt(observedAt),
    source,
    sourceKind: 'cached',
    summary,
  };
}
