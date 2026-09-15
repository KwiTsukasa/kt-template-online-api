import type { DataSchema } from '@/common/automation/data-schema';

export type TaskHandlerReference = { key: string; version: number };
export type TaskHandler = TaskHandlerReference & {
  name: string;
  ownerKind: string;
  idempotent: boolean;
  timeoutMs: number;
  inputSchema: DataSchema;
  outputSchema: DataSchema;
  isAvailable: () => Promise<boolean>;
  execute: (execution: {
    input: Record<string, unknown>;
    runId: string;
    attemptId: string;
    executionKey: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

export const TASK_HANDLERS = Symbol('TASK_HANDLERS');
export interface TaskHandlerRegistryPort {
  register: (handler: TaskHandler) => () => void;
}
