import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtDateTimeColumn } from '@/common';
import {
  WORKFLOW_ACTIVE_SUBJECT_EXPRESSION,
  WORKFLOW_ACTIVE_SUBJECT_INDEX,
} from '../../constants/persistence';
import type { WorkflowBusinessContext } from '../../contract/workflow-process.interface';
import type { WorkflowBpmnRunState } from './workflow-bpmn.entity';
import type { WorkflowRunStatus } from '../../contract/workflow-run.types';

@Entity('automation_workflow_run')
@Index('uk_automation_workflow_run_execution', ['executionKey'], {
  unique: true,
})
@Index('idx_automation_workflow_run_pending', ['status', 'nextWakeAt'])
@Index('idx_automation_workflow_run_subject', ['businessSubjectKey', 'status'])
@Index(WORKFLOW_ACTIVE_SUBJECT_INDEX, ['activeBusinessSubjectKey'], {
  unique: true,
})
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
  @Column({
    name: 'active_business_subject_key',
    type: 'varchar',
    length: 64,
    nullable: true,
    asExpression: WORKFLOW_ACTIVE_SUBJECT_EXPRESSION,
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
  })
  activeBusinessSubjectKey: string | null;
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
