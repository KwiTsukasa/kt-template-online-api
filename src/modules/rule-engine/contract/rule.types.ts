import type { DataSchema } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';

export type RuleScalar = boolean | null | number | string;
export type RuleCondition =
  | { type: 'all' | 'any'; rules: RuleCondition[] }
  | { type: 'not'; rule: RuleCondition }
  | { type: 'compare'; path: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists'; value: RuleScalar | RuleScalar[] };
export type RuleDefinition = {
  schemaVersion: 1;
  factSchema: DataSchema;
  testCases: { name: string; facts: Record<string, unknown>; expected: RuleScalar }[];
} & (
  | { mode: 'condition'; condition: RuleCondition }
  | { mode: 'decision-table'; rows: { id: string; condition: RuleCondition; result: RuleScalar }[]; defaultResult: RuleScalar }
);
export type RuleConditionTrace = {
  location: string;
  type: RuleCondition['type'];
  matched: boolean;
  field?: string;
  operator?: string;
};
export type RuleEvaluation = { result: RuleScalar; matchedRowId: string | null; trace: RuleConditionTrace[] };
export const RULE_ENGINE = Symbol('RULE_ENGINE');
export interface RuleEnginePort {
  resolve: (reference: PublishedReference) => Promise<RuleDefinition>;
  evaluate: (reference: PublishedReference, facts: unknown) => Promise<RuleEvaluation>;
}
