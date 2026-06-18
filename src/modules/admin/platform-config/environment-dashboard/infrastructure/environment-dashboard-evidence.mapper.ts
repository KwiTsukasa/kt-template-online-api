import type { EnvironmentEvidence } from '../domain/environment-dashboard.types';
import { normalizeObservedAt } from '../application/environment-dashboard-status.mapper';

/**
 * Creates live evidence from a successful local or remote readonly probe.
 * @param source - Integration or collector name that produced the evidence.
 * @param summary - Human-readable result summary shown in Admin.
 * @param observedAt - Probe timestamp from the source; normalized before returning.
 * @param metadata - Non-secret structured evidence such as counts or versions.
 * @returns Evidence record marked as live.
 */
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

/**
 * Creates evidence for integrations that are intentionally not wired yet.
 * @param source - Integration name such as Jenkins, K8s, Tencent Cloud, or r4se.
 * @param missingConfigKeys - Public env/config keys that explain why the probe is not live.
 * @param documentationPath - Optional repository documentation path for operators.
 * @returns Evidence record marked as unwired instead of pretending to be healthy.
 */
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

/**
 * Creates safe failure evidence from an adapter or collector exception.
 * @param source - Integration name where the failure happened.
 * @param error - Unknown thrown value from the readonly probe.
 * @param observedAt - Failure timestamp when the adapter observed the error.
 * @returns Evidence record with stack traces and object payloads reduced to a message.
 */
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

/**
 * Creates cached evidence with an explicit expiry boundary.
 * @param source - Cache or retained-event source name.
 * @param summary - Operator-facing cached evidence summary.
 * @param observedAt - Original observation time; must not be refreshed by cache reads.
 * @param expiresAt - Expiry time after which the cache cannot produce green status.
 * @returns Evidence record marked as cached with normalized timestamps.
 */
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
