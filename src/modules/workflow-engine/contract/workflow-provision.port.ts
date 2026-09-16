import type { DefinitionProvisionPort } from '@/common/automation/definition-provision.port';
import type { WorkflowBpmnDefinition } from './workflow-bpmn.types';

export const WORKFLOW_DEFINITIONS = Symbol('WORKFLOW_DEFINITIONS');
export type WorkflowDefinitionProvisionPort = DefinitionProvisionPort<WorkflowBpmnDefinition>;
