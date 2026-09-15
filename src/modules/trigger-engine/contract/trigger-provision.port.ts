import type { DefinitionProvisionPort } from '@/common/automation/definition-provision.port';
import type { TriggerDefinition } from './trigger.types';
export const TRIGGER_DEFINITIONS = Symbol('TRIGGER_DEFINITIONS');
export type TriggerDefinitionProvisionPort =
  DefinitionProvisionPort<TriggerDefinition>;
