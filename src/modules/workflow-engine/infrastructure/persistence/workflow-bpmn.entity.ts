import { RUN_STATUS } from '@/common/automation/constants/run-status';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
  WorkflowBpmnCheckpoint,
  WorkflowBpmnJob,
  WorkflowBpmnTransition,
} from '../workflow-bpmn.runtime';
import type { WorkflowActivityState } from '../../contract/workflow-activity.types';
import { WORKFLOW_BPMN_LIMITS } from '../../constants/bpmn';

export interface WorkflowBpmnRunState {
  messages?: import('../../contract/workflow-message.types').WorkflowMessageRecord[];
  correlations?: Record<
    string,
    import('../../contract/workflow-message.types').BpmnCorrelationValues
  >;
  activeActivities?: import('../workflow-bpmn.runtime').WorkflowBpmnActiveActivity[];
  checkpoint: WorkflowBpmnCheckpoint;
  status:
    | typeof RUN_STATUS.waiting
    | typeof RUN_STATUS.succeeded
    | typeof RUN_STATUS.failed;
  error: string | null;
  nextWakeAt: number | null;
  outputs: Record<string, Record<string, unknown>>;
  transitions: WorkflowBpmnTransition[];
}

@Entity('automation_workflow_bpmn_activity')
@Index('idx_workflow_bpmn_activity_element', ['runId', 'elementId'])
export class WorkflowBpmnActivity {
  @PrimaryColumn({ name: 'run_id', type: 'bigint' }) runId: string;
  @PrimaryColumn({
    name: 'execution_id',
    length: WORKFLOW_BPMN_LIMITS.executionIdentityLength,
    collation: 'utf8mb4_bin',
  })
  executionId: string;
  @Column({
    name: 'element_id',
    length: WORKFLOW_BPMN_LIMITS.modelIdentityLength,
    collation: 'utf8mb4_bin',
  })
  elementId: string;
  @Column({ type: 'json' }) job: WorkflowBpmnJob;
  @Column({ name: 'step_state', type: 'json' }) state: WorkflowActivityState;
  @Column({ default: false }) delivered: boolean;
  @Column({ name: 'cancel_requested', default: false })
  cancelRequested: boolean;
}
