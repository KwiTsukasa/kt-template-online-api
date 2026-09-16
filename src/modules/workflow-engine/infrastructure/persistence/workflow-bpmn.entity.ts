import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { WorkflowBpmnCheckpoint, WorkflowBpmnJob, WorkflowBpmnTransition } from '../workflow-bpmn.runtime';
import type { WorkflowNodeRun } from './workflow-run.entities';

export interface WorkflowBpmnRunState {
  activeActivities?: import('../workflow-bpmn.runtime').WorkflowBpmnActiveActivity[];
  checkpoint: WorkflowBpmnCheckpoint;
  status: 'waiting' | 'succeeded' | 'failed';
  error: string | null;
  nextWakeAt: number | null;
  outputs: Record<string, Record<string, unknown>>;
  transitions: WorkflowBpmnTransition[];
}

@Entity('automation_workflow_bpmn_activity')
@Index('idx_workflow_bpmn_activity_element', ['runId', 'elementId'])
export class WorkflowBpmnActivity {
  @PrimaryColumn({ name: 'run_id', type: 'bigint' }) runId: string;
  @PrimaryColumn({ name: 'execution_id', length: 191 }) executionId: string;
  @Column({ name: 'element_id', length: 191 }) elementId: string;
  @Column({ type: 'json' }) job: WorkflowBpmnJob;
  @Column({ name: 'step_state', type: 'json' }) state: WorkflowNodeRun;
  @Column({ default: false }) delivered: boolean;
  @Column({ name: 'cancel_requested', default: false }) cancelRequested: boolean;
}
