import type { RuntimeClassifiedError } from '../errors/runtime-error.types';

export type RuntimeEvidenceStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface RuntimeEvidenceCleanupResult {
  status: RuntimeEvidenceStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeEvidenceAssertion {
  name: string;
  passed: boolean;
  message: string;
}

export interface RuntimeEvidenceInput {
  title: string;
  taskType: string;
  project: string;
  environment: string;
  operation: string;
  target?: string;
  status: RuntimeEvidenceStatus;
  startedAt?: Date;
  endedAt?: Date;
  details?: Record<string, unknown>;
  assertions?: RuntimeEvidenceAssertion[];
  cleanup?: RuntimeEvidenceCleanupResult;
  error?: RuntimeClassifiedError;
}

export interface RuntimeEvidenceRecord extends RuntimeEvidenceInput {
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  schemaVersion: 1;
}
