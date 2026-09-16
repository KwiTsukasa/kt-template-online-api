import type { PublishedReference } from '@/common/automation/definition.types';
import type { TaskHandler } from '@/modules/task-execution/contract/task-handler.port';
import type { WorkflowBpmnDefinition } from '@/modules/workflow-engine/contract/workflow-bpmn.types';
import { KT_BPMN_STEP } from '@/modules/workflow-engine/contract/workflow-bpmn.types';

/**
 * 将已注册业务能力放进标准服务任务，所有输入输出及执行期限都由流程固定版本约束。
 * @param taskRef - 内置动作的不可变发布引用。
 * @param handler - 已注册或迁移时已核验的动作名称、输入输出及期限契约。
 * @returns 可发布并由工作流统一队列执行的标准 JSON 模型。
 */
export function defaultActionWorkflow(taskRef: PublishedReference, handler: Pick<TaskHandler, 'name' | 'inputSchema' | 'outputSchema' | 'timeoutMs'>): WorkflowBpmnDefinition {
  const contract = {
    processRef: null, formRef: null, formMapping: {},
    inputSchema: handler.inputSchema, outputSchema: handler.outputSchema,
    output: Object.fromEntries(handler.outputSchema.fields.map((field) => [field.key, { type: 'node', nodeId: 'Action', field: field.key }])),
    timeoutMs: handler.timeoutMs + 60000,
  };
  const step = {
    kind: 'action', taskRef,
    input: Object.fromEntries(handler.inputSchema.fields.map((field) => [field.key, { type: 'input', field: field.key }])),
  };
  return {
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'https://kwitsukasa.top/workflows/builtin',
      rootElements: [{
        $type: 'bpmn:Process', id: 'Process', name: handler.name, isExecutable: true,
        extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Contract', body: JSON.stringify(contract) }] },
        flowElements: [
          { $type: 'bpmn:StartEvent', id: 'Start', name: '开始' },
          { $type: 'bpmn:ServiceTask', id: 'Action', name: handler.name, implementation: KT_BPMN_STEP, extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: JSON.stringify(step) }] } },
          { $type: 'bpmn:EndEvent', id: 'End', name: '完成' },
          { $type: 'bpmn:SequenceFlow', id: 'Start_Action', sourceRef: { $ref: 'Start' }, targetRef: { $ref: 'Action' } },
          { $type: 'bpmn:SequenceFlow', id: 'Action_End', sourceRef: { $ref: 'Action' }, targetRef: { $ref: 'End' } },
        ],
      }],
      diagrams: [{ $type: 'bpmndi:BPMNDiagram', id: 'Diagram', plane: {
        $type: 'bpmndi:BPMNPlane', id: 'Plane', bpmnElement: { $ref: 'Process' },
        planeElement: [
          { $type: 'bpmndi:BPMNShape', id: 'Start_di', bpmnElement: { $ref: 'Start' }, bounds: { $type: 'dc:Bounds', x: 80, y: 138, width: 40, height: 40 } },
          { $type: 'bpmndi:BPMNShape', id: 'Action_di', bpmnElement: { $ref: 'Action' }, bounds: { $type: 'dc:Bounds', x: 220, y: 120, width: 200, height: 76 } },
          { $type: 'bpmndi:BPMNShape', id: 'End_di', bpmnElement: { $ref: 'End' }, bounds: { $type: 'dc:Bounds', x: 520, y: 138, width: 40, height: 40 } },
        ],
      } }],
    },
  };
}
