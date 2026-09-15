import type { DataScalar } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { RuleScalar } from '@/modules/rule-engine/contract/rule.types';

export type ScheduleBinding =
  | { source: 'literal'; value: DataScalar }
  | { source: 'event'; field: string }
  | { source: 'occurrence'; field: 'id' | 'registrationId' | 'occurredAt' };
export type ScheduleTarget = {
  type: 'task' | 'workflow';
  reference: PublishedReference;
};
export type ScheduleDefinition = {
  schemaVersion: 1;
  triggerRef: PublishedReference | null;
  target: ScheduleTarget | null;
  input: Record<string, ScheduleBinding>;
  admission: {
    ruleRef: PublishedReference;
    facts: Record<string, ScheduleBinding>;
    expected: RuleScalar;
  } | null;
  overlap: 'allow' | 'skip';
  taskDeadlineMs: number;
};
export type ScheduleDispatchStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';
export const SCHEDULE_PLANS = Symbol('SCHEDULE_PLANS');
export interface SchedulePlanPort {
  state: (scheduleId: string) => Promise<{
    scheduleId: string;
    revision: number;
    enabled: boolean;
    activeVersion: number | null;
    activationStatus: string | null;
    manualTrigger: boolean;
    nextRunAt: string | null;
    error: string | null;
  }>;
  enable: (
    reference: PublishedReference,
    expectedRevision: number,
  ) => Promise<unknown>;
  disable: (scheduleId: string, expectedRevision: number) => Promise<unknown>;
}
