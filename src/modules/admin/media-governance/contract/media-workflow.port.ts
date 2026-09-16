import type {
  WorkflowBusinessPort,
  WorkflowProcess,
} from '@/modules/workflow-engine/contract/workflow-process.interface';
import type { WorkflowExecutionPort } from '@/modules/workflow-engine/contract/workflow.types';

export const MEDIA_WORKFLOW = Symbol('MEDIA_WORKFLOW');
export interface MediaWorkflowPort {
  readonly process: WorkflowProcess;
  readonly processes: readonly WorkflowProcess[];
  connect: (
    businesses: WorkflowBusinessPort,
    execution: WorkflowExecutionPort,
  ) => () => void;
}
