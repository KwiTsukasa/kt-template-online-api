import type {
  WorkflowHumanTaskView,
  WorkflowRunView,
} from './workflow-run.types';
import type { DataScalar } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { FormDefinition } from '@/modules/form-definition/contract/form.types';

import type {
  WorkflowBpmnDefinition,
  WorkflowBpmnContract,
} from './workflow-bpmn.types';

export type ValueReference =
  | { type: 'input'; field: string }
  | { type: 'node'; nodeId: string; field: string };
export type ValueBinding =
  | ValueReference
  | { type: 'literal'; value: DataScalar }
  | { type: 'iteration' }
  | { type: 'first'; sources: ValueReference[] };
export type WorkflowDocument = WorkflowBpmnDefinition;
export type WorkflowIssue = {
  nodeId?: string;
  edgeId?: string;
  fieldPath?: string;
  code: string;
  message: string;
};
export type WorkflowValidation = {
  valid: boolean;
  issues: WorkflowIssue[];
  order: string[];
};
export const WORKFLOW_EXECUTION = Symbol('WORKFLOW_EXECUTION');
export interface WorkflowExecutionPort {
  receiveMessage: (
    runId: string,
    delivery: import('./workflow-message.types').WorkflowMessageDelivery,
  ) => Promise<import('./workflow-message.types').WorkflowMessageReceipt>;
  humanTasks: (runId: string) => Promise<WorkflowHumanTaskView[]>;
  completeHumanTask: (
    runId: string,
    executionId: string,
    actorId: string,
    values: unknown,
  ) => Promise<WorkflowRunView>;
  presentation: (
    reference: PublishedReference,
  ) => Promise<{ definition: WorkflowDocument; form: FormDefinition | null }>;
  contract: (reference: PublishedReference) => Promise<WorkflowBpmnContract>;
  resolve: (reference: PublishedReference) => Promise<WorkflowDocument>;
  start: (
    reference: PublishedReference,
    input: Record<string, unknown>,
    executionKey: string,
  ) => Promise<{ runId: string }>;
  read: (runId: string) => Promise<WorkflowRunView>;
  cancel: (runId: string) => Promise<WorkflowRunView>;
}
