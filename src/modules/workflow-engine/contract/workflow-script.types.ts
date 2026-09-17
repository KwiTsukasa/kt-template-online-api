import type { WORKFLOW_SCRIPT_PROTOCOL } from '../constants/script';
import type { WorkflowActivityControl } from './workflow-activity.types';

export interface WorkflowScriptBatchContext {
  readonly processKey: string;
  readonly params: readonly Record<string, unknown>[];
  readonly control: WorkflowActivityControl;
}
import { RUN_STATUS } from '@/common/automation/constants/run-status';
import type { DataSchema, DataScalar } from '@/common/automation/data-schema';
import type { ValueBinding } from './workflow.types';

export const WORKFLOW_SCRIPT_ASSETS = Symbol('WORKFLOW_SCRIPT_ASSETS');
export interface WorkflowScriptAssetsPort {
  upload: (input: {
    filename: unknown;
    source: unknown;
    target: unknown;
  }) => Promise<unknown>;
}

export type WorkflowScriptReference = {
  key: string;
  version: number;
  sha256: string;
};
export type WorkflowScriptCall = WorkflowScriptReference & {
  timeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
  params: Record<string, ValueBinding>;
};
export type WorkflowScriptResult = {
  executionId: string;
  script: WorkflowScriptReference;
  status:
    | typeof RUN_STATUS.succeeded
    | typeof RUN_STATUS.failed
    | typeof RUN_STATUS.cancelled;
  exitCode: number | null;
  output: Record<string, unknown>;
};
export type WorkflowScriptObservation =
  | WorkflowScriptResult
  | { status: typeof RUN_STATUS.running; executionId: string }
  | { status: typeof RUN_STATUS.unconfirmed; executionId: string };
export type WorkflowScriptAttempt = Omit<WorkflowScriptResult, 'status'> & {
  index: number;
  attempt: number;
  status:
    | typeof RUN_STATUS.running
    | typeof RUN_STATUS.succeeded
    | typeof RUN_STATUS.failed
    | typeof RUN_STATUS.cancelled
    | typeof RUN_STATUS.unconfirmed;
  startedAt: string;
  finishedAt: string | null;
  retryable?: boolean;
};
export type WorkflowScriptDefinition = WorkflowScriptReference & {
  protocol: typeof WORKFLOW_SCRIPT_PROTOCOL;
  name: string;
  description: string;
  runtime: 'bash' | 'node' | 'python';
  path: string;
  target: 'local' | 'nas';
  processKey: string;
  stepKey: string;
  maxTimeoutMs: number;
  idempotent: boolean;
  paramsSchema: DataSchema;
  resultSchema: DataSchema;
  defaults: Record<string, DataScalar>;
};
