import type { DefinitionProvisionPort } from '@/common/automation/definition-provision.port';
import type { ScheduleDefinition } from './schedule.types';
export const SCHEDULE_DEFINITIONS = Symbol('SCHEDULE_DEFINITIONS');
export type ScheduleDefinitionProvisionPort =
  DefinitionProvisionPort<ScheduleDefinition>;
