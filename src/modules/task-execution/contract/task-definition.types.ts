import { RUN_STATUS } from '@/common/automation/constants/run-status';
import type { TaskHandlerReference } from './task-handler.port';
import type { DataSchema } from '@/common/automation/data-schema';

export type AtomicTaskDefinition = {
  schemaVersion: 1;
  handler: TaskHandlerReference;
  contract: {
    inputSchema: DataSchema;
    outputSchema: DataSchema;
    idempotent: boolean;
    ownerKind: string;
  };
  timeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
};
export type AtomicRunStatus =
  | typeof RUN_STATUS.pending
  | typeof RUN_STATUS.running
  | typeof RUN_STATUS.succeeded
  | typeof RUN_STATUS.failed
  | typeof RUN_STATUS.cancelled;
export type AtomicRunView = {
  runId: string;
  taskId: string;
  taskVersion: number;
  status: AtomicRunStatus;
  output: Record<string, unknown>;
  error: string | null;
  requiresReview: boolean;
};
