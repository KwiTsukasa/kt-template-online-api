import type { WorkflowNodeStatus } from './workflow-run.types';
import type { WorkflowScriptAttempt } from './workflow-script.types';
import type { WorkflowBusinessContext } from './workflow-process.interface';

export type WorkflowNodeProgress = {
  status: WorkflowNodeStatus;
  output: Record<string, unknown>;
};

export interface WorkflowActivityControl {
  readonly save: () => Promise<void>;
  readonly shouldStop: () => Promise<boolean>;
}

export interface WorkflowActivityContext {
  readonly runId: string;
  readonly executionId: string;
  readonly deadlineAt: number;
  readonly business: WorkflowBusinessContext | null;
  readonly input: Record<string, unknown>;
  readonly progress: ReadonlyMap<string, WorkflowNodeProgress>;
  readonly iterationIndex?: number;
  readonly control: WorkflowActivityControl;
}

export interface WorkflowActivityState {
  status: WorkflowNodeStatus;
  visit: number;
  taskRunId: string | null;
  businessReceipt: string | null;
  preparedInput: Record<string, unknown> | null;
  scriptAttempts: WorkflowScriptAttempt[] | null;
  outputValues: Record<string, unknown>;
  errorMessage: string | null;
  wakeAt: Date | string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
}

export type WorkflowNodeSnapshot = WorkflowActivityState & {
  runId: string;
  nodeId: string;
  loopIteration: number;
  loopPath: Record<string, number>;
  selectedPorts: string[];
};
