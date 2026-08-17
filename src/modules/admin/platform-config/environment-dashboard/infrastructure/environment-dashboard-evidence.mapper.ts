import type { EnvironmentEvidence } from '../domain/environment-dashboard.types';
import { normalizeObservedAt } from '../application/environment-dashboard-status.mapper';

/**
 * 把领域字段投影为实时证据。
 * @param source - 决定把领域字段投影为实时证据内容、边界或目标的 `source` 值。
 * @param summary - 决定把领域字段投影为实时证据内容、边界或目标的 `summary` 值。
 * @param observedAt - 用于过期、排序或租约判定的时间基准；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param metadata - 决定把领域字段投影为实时证据内容、边界或目标的 `metadata` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `metadata`、`observedAt`、`source`、`sourceKind`、`summary` 字段的把领域字段投影为实时证据。
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
 * 把领域字段投影为未接线的证据。
 * @param source - 决定把领域字段投影为未接线的证据内容、边界或目标的 `source` 值。
 * @param missingConfigKeys - 用于批量校验或读取把领域字段投影为未接线的证据的键集合。
 * @param documentationPath - 必须保持在受控根目录内的documentation路径；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `metadata`、`observedAt`、`source`、`sourceKind`、`summary` 字段的把领域字段投影为未接线的证据。
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
      (() => {
        if (missingConfigKeys.length > 0) {
          return `缺少只读观测配置：${missingConfigKeys.join(', ')}`;
        }
        return '只读观测入口尚未接入';
      })(),
  };
}

/**
 * 把领域字段投影为错误证据。
 * @param source - 决定把领域字段投影为错误证据内容、边界或目标的 `source` 值。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @param observedAt - 用于过期、排序或租约判定的时间基准；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `observedAt`、`source`、`sourceKind`、`summary` 字段的把领域字段投影为错误证据。
 */
export function errorEvidence(
  source: string,
  error: unknown,
  observedAt?: Date | number | string,
): EnvironmentEvidence {
  const summary =
    (() => {
      if (error instanceof Error) {
        return error.message;
      }
      if (typeof error === 'string') {
        return error;
      }
      return '只读观测失败';
    })();

  return {
    observedAt: normalizeObservedAt(observedAt),
    source,
    sourceKind: 'derived',
    summary,
  };
}

/**
 * 把领域字段投影为已缓存的证据。
 * @param source - 决定把领域字段投影为已缓存的证据内容、边界或目标的 `source` 值。
 * @param summary - 决定把领域字段投影为已缓存的证据内容、边界或目标的 `summary` 值。
 * @param observedAt - 用于过期、排序或租约判定的时间基准。
 * @param expiresAt - 用于过期、排序或租约判定的时间基准。
 * @returns 包含 `expiresAt`、`observedAt`、`source`、`sourceKind`、`summary` 字段的把领域字段投影为已缓存的证据。
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
