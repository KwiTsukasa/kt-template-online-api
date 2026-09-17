import { RUN_STATUS } from '@/common/automation/constants/run-status';
import type { DataSchema, DataScalar } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';

export type TriggerEventSource = {
  key: string;
  version: number;
  name: string;
  payloadSchema: DataSchema;
};
export const TRIGGER_EVENT_SOURCES = Symbol('TRIGGER_EVENT_SOURCES');
export interface TriggerEventRegistryPort {
  register: (source: TriggerEventSource) => () => void;
}
export type TriggerRegistrationView = {
  id: string;
  consumerKey: string;
  triggerRef: PublishedReference;
  status: 'prepared' | 'active' | 'closed';
  nextAt: Date | null;
};
export type TriggerOccurrenceView = {
  id: string;
  registrationId: string;
  triggerRef: PublishedReference;
  occurredAt: Date;
  payload: Record<string, DataScalar>;
  status: typeof RUN_STATUS.pending | 'acknowledged';
};
export type TriggerEvent = {
  eventKey: string;
  eventVersion: number;
  eventId: string;
  occurredAt: string;
  payload: Record<string, DataScalar>;
};
export const TRIGGER_OCCURRENCES = Symbol('TRIGGER_OCCURRENCES');
export interface TriggerOccurrencePort {
  prepare: (request: {
    consumerKey: string;
    triggerRef: PublishedReference;
  }) => Promise<TriggerRegistrationView>;
  activate: (registrationId: string) => Promise<TriggerRegistrationView>;
  close: (registrationId: string) => Promise<TriggerRegistrationView>;
  readRegistration: (
    registrationId: string,
  ) => Promise<TriggerRegistrationView>;
  pending: (registrationId: string) => Promise<TriggerOccurrenceView[]>;
  acknowledge: (occurrenceId: string, registrationId: string) => Promise<void>;
  fire: (
    registrationId: string,
    eventId: string,
  ) => Promise<TriggerOccurrenceView>;
}
export const TRIGGER_EVENTS = Symbol('TRIGGER_EVENTS');
export interface TriggerEventPort {
  publish: (event: TriggerEvent) => Promise<{ occurrenceIds: string[] }>;
}
