import {
  EscalationEventDefinition,
  MessageEventDefinition,
  SignalEventDefinition,
  Task,
} from 'bpmn-elements';
import {
  WorkflowMultiInstance,
  WorkflowStandardLoop,
} from './workflow-bpmn-loop';
import { WorkflowInclusiveGateway } from './workflow-bpmn-inclusive';
import { WorkflowEventBasedGateway } from './workflow-bpmn-event-gateway';
import { WorkflowComplexGateway } from './workflow-bpmn-complex';
import { WorkflowEventSubProcess } from './workflow-bpmn-event-subprocess';
import { WorkflowConcurrentTask } from './workflow-bpmn-task';
import {
  repeatingBpmnEvent,
  WorkflowCompensateEventDefinition,
  WorkflowConcurrentBoundary,
} from './workflow-bpmn-boundary';
import { WorkflowCompensationThrowActivity } from './workflow-bpmn-compensation';
import { WorkflowTransaction } from './workflow-bpmn-transaction';

/**
 * 统一注册工作流语义适配，每次推进绑定本次检查点的重复事件记录，避免不同流程共享可变状态。
 * @param boundaryOccurrences - 当前流程已消费的非中断边界事件身份。
 * @returns 交给原生引擎的元素工厂表；未列出的标准元素使用引擎实现。
 */
export function createWorkflowBpmnElements(
  boundaryOccurrences: Record<string, string[]>,
) {
  return {
    Transaction: WorkflowTransaction,
    IntermediateThrowEvent: WorkflowCompensationThrowActivity,
    EndEvent: WorkflowCompensationThrowActivity,
    CompensateEventDefinition: WorkflowCompensateEventDefinition,
    BoundaryEvent: WorkflowConcurrentBoundary,
    SignalEventDefinition: repeatingBpmnEvent(
      SignalEventDefinition,
      boundaryOccurrences,
    ),
    MessageEventDefinition: repeatingBpmnEvent(
      MessageEventDefinition,
      boundaryOccurrences,
    ),
    EscalationEventDefinition: repeatingBpmnEvent(
      EscalationEventDefinition,
      boundaryOccurrences,
    ),
    ServiceTask: WorkflowConcurrentTask,
    BusinessRuleTask: WorkflowConcurrentTask,
    SendTask: WorkflowConcurrentTask,
    ScriptTask: WorkflowConcurrentTask,
    UserTask: WorkflowConcurrentTask,
    ManualTask: Task,
    SubProcess: WorkflowEventSubProcess,
    InclusiveGateway: WorkflowInclusiveGateway,
    ComplexGateway: WorkflowComplexGateway,
    EventBasedGateway: WorkflowEventBasedGateway,
    StandardLoopCharacteristics: WorkflowStandardLoop,
    MultiInstanceLoopCharacteristics: WorkflowMultiInstance,
  };
}
