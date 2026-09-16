import type { DataSchema, DataScalar } from '@/common/automation/data-schema';
import type { ValueBinding } from './workflow.types';

export const WORKFLOW_SCRIPT_ASSETS = Symbol('WORKFLOW_SCRIPT_ASSETS');
export interface WorkflowScriptAssetsPort {
  upload: (input: { filename: unknown; source: unknown; target: unknown }) => Promise<unknown>;
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
  status: 'succeeded' | 'failed' | 'cancelled';
  exitCode: number | null;
  output: Record<string, unknown>;
};
export type WorkflowScriptAttempt = Omit<WorkflowScriptResult, 'status'> & {
  index: number;
  attempt: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unconfirmed';
  startedAt: string;
  finishedAt: string | null;
  retryable?: boolean;
};
export type WorkflowScriptDefinition = WorkflowScriptReference & {
  protocol: 'kt.workflow.script.v1';
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
