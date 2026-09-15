import type { PublishedReference } from '@/common/automation/definition.types';
import type { DataSchema } from '@/common/automation/data-schema';

export type TriggerConfiguration =
  | { type: 'cron'; expression: string; timezone: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'once'; at: string }
  | {
      type: 'event';
      eventKey: string;
      eventVersion: number;
      payloadSchema: DataSchema;
    }
  | { type: 'manual' };
export type TriggerDefinition = {
  schemaVersion: 1;
  trigger: TriggerConfiguration;
};
export const TRIGGER_ENGINE = Symbol('TRIGGER_ENGINE');
export interface TriggerEnginePort {
  resolve: (reference: PublishedReference) => Promise<TriggerDefinition>;
  next: (reference: PublishedReference, after: Date) => Promise<Date | null>;
}
