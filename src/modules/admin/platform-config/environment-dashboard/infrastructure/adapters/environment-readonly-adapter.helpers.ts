import { unwiredEvidence } from '../environment-dashboard-evidence.mapper';
import type { EnvironmentSignal } from '../../domain/environment-dashboard.types';

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
