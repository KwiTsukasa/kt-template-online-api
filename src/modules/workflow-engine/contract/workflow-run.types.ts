import type { PublishedReference } from '@/common/automation/definition.types';
import type { FormDefinition } from '@/modules/form-definition/contract/form.types';
import type { WorkflowBusinessContext } from './workflow-process.interface';
import type { WorkflowScriptAttempt } from './workflow-script.types';
import type { WorkflowBpmnTransition } from '../infrastructure/workflow-bpmn.runtime';

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type WorkflowNodeStatus =
  | 'pending'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';
export type WorkflowNodeView = {
  nodeId: string;
  status: WorkflowNodeStatus;
  taskRunId: string | null;
  businessReceipt?: string | null;
  visit: number;
  loopIteration: number;
  loopPath: Record<string, number>;
  scriptAttempts: WorkflowScriptAttempt[];
  output: Record<string, unknown>;
  selectedPorts: string[];
  wakeAt: string | null;
  error: string | null;
};
export type WorkflowNodeVisitView = Pick<
  WorkflowNodeView,
  | 'nodeId'
  | 'status'
  | 'taskRunId'
  | 'businessReceipt'
  | 'visit'
  | 'loopPath'
  | 'scriptAttempts'
  | 'output'
  | 'error'
> & { startedAt: string | null; finishedAt: string | null };
export type WorkflowNodeVisitPage = {
  items: WorkflowNodeVisitView[];
  nextBeforeVisit: number | null;
};
export type WorkflowRunView = {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  business?: WorkflowBusinessContext | null;
  input: Record<string, unknown>;
  formValues: Record<string, unknown> | null;
  output: Record<string, unknown>;
  error: string | null;
  nodes: WorkflowNodeView[];
  activities?: Array<{ executionId: string; nodeId: string; status: WorkflowNodeStatus; visit: number; output: Record<string, unknown>; error: string | null }>;
  transitions?: WorkflowBpmnTransition[];
  activeActivities?: import('../infrastructure/workflow-bpmn.runtime').WorkflowBpmnActiveActivity[];
};

export interface WorkflowHumanTaskView {
  name: string;
  executionId: string;
  nodeId: string;
  visit: number;
  formRef: PublishedReference | null;
  form: FormDefinition | null;
  writableFields: string[];
  values: Record<string, unknown>;
}
