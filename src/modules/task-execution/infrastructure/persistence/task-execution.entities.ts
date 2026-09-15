import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtDateTimeColumn } from '@/common';
import {
  DefinitionDraftRow,
  DefinitionRevisionRow,
} from '@/common/automation/definition.entities';
import type { AtomicRunStatus } from '../../contract/task-definition.types';

@Entity('automation_task')
export class AtomicTaskDraft extends DefinitionDraftRow {}

@Entity('automation_task_revision')
export class AtomicTaskRevision extends DefinitionRevisionRow {}

@Entity('automation_task_run')
@Index('uk_automation_task_run_execution', ['executionKey'], { unique: true })
@Index('idx_automation_task_run_pending', ['status', 'nextAttemptAt'])
@Index('idx_automation_task_run_parent', ['parentRunId', 'nodeId'])
export class AtomicTaskRun {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'task_id', type: 'bigint' }) taskId: string;
  @Column({ name: 'task_version', type: 'int' }) taskVersion: number;
  @Column({ name: 'execution_key', length: 64 }) executionKey: string;
  @Column({ name: 'request_hash', length: 64 }) requestHash: string;
  @Column({ name: 'parent_run_id', type: 'bigint', nullable: true })
  parentRunId: string | null;
  @Column({ name: 'node_id', length: 64, nullable: true }) nodeId:
    | string
    | null;
  @Column({ length: 16 }) status: AtomicRunStatus;
  @Column({ name: 'input_values', type: 'json' }) inputValues: Record<
    string,
    unknown
  >;
  @Column({ name: 'output_values', type: 'json', nullable: true })
  outputValues: Record<string, unknown> | null;
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;
  @Column({ name: 'cancel_requested', default: false })
  cancelRequested: boolean;
  @Column({ name: 'requires_review', default: false }) requiresReview: boolean;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'deadline_at' }) deadlineAt: KtDateTime;
  @KtDateTimeColumn({ name: 'next_attempt_at' }) nextAttemptAt: KtDateTime;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}

@Entity('automation_task_attempt')
@Index('uk_automation_task_attempt', ['runId', 'attemptNo'], { unique: true })
export class AtomicTaskAttempt {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'run_id', type: 'bigint' }) runId: string;
  @Column({ name: 'attempt_no', type: 'int' }) attemptNo: number;
  @Column({ length: 16 }) status: AtomicRunStatus;
  @Column({ name: 'runtime_identity', length: 191 }) runtimeIdentity: string;
  @Column({ name: 'handler_key', length: 191 }) handlerKey: string;
  @Column({ name: 'handler_version', type: 'int' }) handlerVersion: number;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'started_at' }) startedAt: KtDateTime;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
}

@Entity('automation_task_run_review')
export class AtomicTaskRunReview {
  @PrimaryColumn({ name: 'run_id', type: 'bigint' }) runId: string;
  @Column({ name: 'reviewed_by', type: 'bigint' }) reviewedBy: string;
  @Column({ length: 32 }) resolution: 'effect-confirmed' | 'no-effect' | 'compensated';
  @Column({ length: 2048 }) reason: string;
  @KtCreateDateColumn({ name: 'reviewed_at' }) reviewedAt: KtDateTime;
}
