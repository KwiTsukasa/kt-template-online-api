import type { WorkflowHumanTaskView } from './workflow-run.types';
import type { DataSchema, DataScalar } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { RuleScalar } from '@/modules/rule-engine/contract/rule.types';
import type { FormDefinition } from '@/modules/form-definition/contract/form.types';
import type { WorkflowRunView } from './workflow-run.types';
import type { WorkflowProcessReference } from './workflow-process.interface';
import type { WorkflowScriptCall } from './workflow-script.types';
import type { WorkflowBpmnDefinition, WorkflowBpmnContract } from './workflow-bpmn.types';

export type ValueReference =
  | { type: 'input'; field: string }
  | { type: 'node'; nodeId: string; field: string };
export type ValueBinding =
  | ValueReference
  | { type: 'literal'; value: DataScalar }
  | { type: 'iteration' }
  | { type: 'first'; sources: ValueReference[] };
export type WorkflowNode = { id: string; name: string } & (
  | { type: 'start' }
  | { type: 'end'; outcome?: 'succeeded' | 'failed' | 'cancelled' }
  | {
      type: 'task';
      taskRef: PublishedReference;
      input: Record<string, ValueBinding>;
    }
  | {
      type: 'business';
      stepKey: string;
      scripts: WorkflowScriptCall[];
      input: Record<string, ValueBinding>;
    }
  | {
      type: 'rule';
      ruleRef: PublishedReference;
      facts: Record<string, ValueBinding>;
      branches: { port: string; value: RuleScalar }[];
    }
  | { type: 'fork'; joinId: string }
  | { type: 'join'; forkId: string }
  | { type: 'wait'; durationMs: number }
  | {
      type: 'loop';
      maxIterations: number;
      condition: {
        ruleRef: PublishedReference;
        facts: Record<string, ValueBinding>;
        continueOn: boolean;
      } | null;
    }
);
export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
};
export type WorkflowGraph = {
  schemaVersion: 1;
  processRef?: WorkflowProcessReference | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema: DataSchema;
  outputSchema: DataSchema;
  output: Record<string, ValueBinding>;
  formRef: PublishedReference | null;
  formMapping: Record<string, string>;
  timeoutMs: number;
};
export type WorkflowPortSide = 'left' | 'right' | 'top' | 'bottom';
export type WorkflowNodeLayout = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  shape?: 'rounded' | 'rectangle' | 'capsule' | 'diamond';
  inputSide?: WorkflowPortSide;
  outputSide?: WorkflowPortSide;
};
export type GraphLayout = {
  schemaVersion: 1;
  direction?: 'horizontal' | 'vertical';
  nodes: Record<string, WorkflowNodeLayout>;
  edges: Record<string, { vertices: { x: number; y: number }[] }>;
  viewport: { x: number; y: number; zoom: number };
};
export type WorkflowDefinition = { graph: WorkflowGraph; layout: GraphLayout };
export type WorkflowDocument = WorkflowDefinition | WorkflowBpmnDefinition;
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
  receiveMessage: (runId: string, delivery: import('./workflow-message.types').WorkflowMessageDelivery) => Promise<import('./workflow-message.types').WorkflowMessageReceipt>;
  humanTasks: (runId: string) => Promise<WorkflowHumanTaskView[]>;
  completeHumanTask: (runId: string, executionId: string, actorId: string, values: unknown) => Promise<WorkflowRunView>;
  presentation: (reference: PublishedReference) => Promise<{ definition: WorkflowDocument; form: FormDefinition | null }>;
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
