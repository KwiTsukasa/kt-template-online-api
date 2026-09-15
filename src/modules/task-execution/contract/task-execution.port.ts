import type { DataSchema } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { AtomicRunView } from './task-definition.types';

export type TaskCapability = {
  id: string;
  version: number;
  name: string;
  key: string;
  ownerKind: string;
  available: boolean;
  idempotent: boolean;
  timeoutMs: number;
  inputSchema: DataSchema;
  outputSchema: DataSchema;
};
export type TaskExecutionRequest = {
  taskRef: PublishedReference;
  executionKey: string;
  input: Record<string, unknown>;
  parentRunId?: string;
  nodeId?: string;
  deadlineAt: number;
};
export type AtomicTaskResult = {
  runId: string;
  status: 'failed' | 'succeeded' | 'skipped';
  output: Record<string, unknown>;
  error?: string;
};
export const TASK_EXECUTION = Symbol('TASK_EXECUTION');
export interface TaskExecutionPort {
  resolve: (reference: PublishedReference) => Promise<TaskCapability>;
  start: (request: TaskExecutionRequest) => Promise<AtomicRunView>;
  read: (runId: string) => Promise<AtomicRunView>;
  cancel: (runId: string) => Promise<AtomicRunView>;
  cancelParent: (parentRunId: string) => Promise<{ active: boolean }>;
}
