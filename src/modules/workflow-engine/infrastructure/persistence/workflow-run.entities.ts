import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtDateTimeColumn } from '@/common';
import type { WorkflowBusinessContext } from '../../contract/workflow-process.interface';
import type { WorkflowScriptAttempt } from '../../contract/workflow-script.types';
import type { WorkflowBpmnRunState } from './workflow-bpmn.entity';
import type {
  WorkflowNodeStatus,
  WorkflowRunStatus,
} from '../../contract/workflow-run.types';

@Entity('automation_workflow_run')
@Index('uk_automation_workflow_run_execution', ['executionKey'], {
  unique: true,
})
@Index('idx_automation_workflow_run_pending', ['status', 'nextWakeAt'])
@Index('idx_automation_workflow_run_subject', ['businessSubjectKey', 'status'])
export class WorkflowRun {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'workflow_id', type: 'bigint' }) workflowId: string;
  @Column({ name: 'workflow_version', type: 'int' }) workflowVersion: number;
  @Column({ name: 'execution_key', length: 64 }) executionKey: string;
  @Column({ name: 'request_hash', length: 64 }) requestHash: string;
  @Column({ name: 'business_context', type: 'json', nullable: true })
  businessContext: WorkflowBusinessContext | null;
  @Column({
    name: 'business_subject_key',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  businessSubjectKey: string | null;
  @Column({ length: 16 }) status: WorkflowRunStatus;
  @Column({ name: 'input_values', type: 'json' }) inputValues: Record<
    string,
    unknown
  >;
  @Column({ name: 'form_values', type: 'json', nullable: true })
  formValues: Record<string, unknown> | null;
  @Column({ name: 'output_values', type: 'json', nullable: true })
  outputValues: Record<string, unknown> | null;
  @Column({ name: 'bpmn_state', type: 'json', nullable: true })
  bpmnState: WorkflowBpmnRunState | null;
  @Column({ name: 'cancel_requested', default: false })
  cancelRequested: boolean;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'deadline_at' }) deadlineAt: KtDateTime;
  @KtDateTimeColumn({ name: 'next_wake_at' }) nextWakeAt: KtDateTime;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}

@Entity('automation_workflow_node_run')
@Index('idx_automation_workflow_node_task', ['taskRunId'])
export class WorkflowNodeRun {
  @PrimaryColumn({ name: 'run_id', type: 'bigint' }) runId: string;
  @PrimaryColumn({ name: 'node_id', length: 64 }) nodeId: string;
  @Column({ length: 16 }) status: WorkflowNodeStatus;
  @Column({ type: 'int', default: 1 }) visit: number;
  @Column({ name: 'loop_iteration', type: 'int', default: 0 })
  loopIteration: number;
  @Column({ name: 'loop_path', type: 'json', nullable: true }) loopPath: Record<
    string,
    number
  > | null;
  @Column({
    name: 'business_receipt',
    type: 'varchar',
    length: 191,
    nullable: true,
  })
  businessReceipt: string | null;
  @Column({ name: 'prepared_input', type: 'json', nullable: true })
  preparedInput: Record<string, unknown> | null;
  @Column({ name: 'script_attempts', type: 'json', nullable: true })
  scriptAttempts: WorkflowScriptAttempt[] | null;
  @Column({ name: 'task_run_id', type: 'bigint', nullable: true }) taskRunId:
    | string
    | null;
  @Column({ name: 'selected_ports', type: 'json' }) selectedPorts: string[];
  @Column({ name: 'output_values', type: 'json' }) outputValues: Record<
    string,
    unknown
  >;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'wake_at', nullable: true })
  wakeAt: KtDateTime | null;
  @KtDateTimeColumn({ name: 'started_at', nullable: true })
  startedAt: KtDateTime | null;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
}

@Entity('automation_workflow_node_visit')
export class WorkflowNodeVisit {
  @PrimaryColumn({ name: 'run_id', type: 'bigint' }) runId: string;
  @PrimaryColumn({ name: 'node_id', length: 64 }) nodeId: string;
  @PrimaryColumn({ type: 'int' }) visit: number;
  @Column({ length: 16 }) status: WorkflowNodeStatus;
  @Column({ name: 'loop_path', type: 'json' }) loopPath: Record<string, number>;
  @Column({ name: 'output_values', type: 'json' }) outputValues: Record<
    string,
    unknown
  >;
  @Column({ name: 'script_attempts', type: 'json', nullable: true })
  scriptAttempts: WorkflowScriptAttempt[] | null;
  @Column({ name: 'task_run_id', type: 'bigint', nullable: true }) taskRunId:
    | string
    | null;
  @Column({
    name: 'business_receipt',
    type: 'varchar',
    length: 191,
    nullable: true,
  })
  businessReceipt: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'started_at', nullable: true })
  startedAt: KtDateTime | null;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
}
