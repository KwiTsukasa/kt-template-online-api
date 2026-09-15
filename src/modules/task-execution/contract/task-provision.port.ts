import type { DefinitionProvisionPort } from '@/common/automation/definition-provision.port';
import type { AtomicTaskDefinition } from './task-definition.types';
export const TASK_DEFINITIONS = Symbol('TASK_DEFINITIONS');
export type TaskDefinitionProvisionPort =
  DefinitionProvisionPort<AtomicTaskDefinition>;
