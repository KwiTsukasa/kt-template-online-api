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
  output: Record<string, unknown>;
  selectedPorts: string[];
  wakeAt: string | null;
  error: string | null;
};
export type WorkflowRunView = {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  formValues: Record<string, unknown> | null;
  output: Record<string, unknown>;
  error: string | null;
  nodes: WorkflowNodeView[];
};
