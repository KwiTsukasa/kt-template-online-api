import {
  BPMN_COORDINATE,
  BPMN_DI,
  BPMN_EXTENSION,
  BPMN_TYPE,
} from '@/modules/workflow-engine/constants/bpmn';
import { KT_BPMN_STEP } from '@/modules/workflow-engine/constants/bpmn';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { TaskHandler } from '@/modules/task-execution/contract/task-handler.port';
import type { WorkflowBpmnDefinition } from '@/modules/workflow-engine/contract/workflow-bpmn.types';

/**
 * 将已注册业务能力放进标准服务任务，所有输入输出及执行期限都由流程固定版本约束。
 * @param taskRef - 内置动作的不可变发布引用。
 * @param handler - 已注册或迁移时已核验的动作名称、输入输出及期限契约。
 * @returns 可发布并由工作流统一队列执行的标准 JSON 模型。
 */
export function defaultActionWorkflow(
  taskRef: PublishedReference,
  handler: Pick<
    TaskHandler,
    'name' | 'inputSchema' | 'outputSchema' | 'timeoutMs'
  >,
): WorkflowBpmnDefinition {
  const contract = {
    processRef: null,
    formRef: null,
    formMapping: {},
    inputSchema: handler.inputSchema,
    outputSchema: handler.outputSchema,
    output: Object.fromEntries(
      handler.outputSchema.fields.map((field) => [
        field.key,
        { type: 'node', nodeId: 'Action', field: field.key },
      ]),
    ),
    timeoutMs: handler.timeoutMs + 60000,
  };
  const step = {
    kind: 'action',
    taskRef,
    input: Object.fromEntries(
      handler.inputSchema.fields.map((field) => [
        field.key,
        { type: 'input', field: field.key },
      ]),
    ),
  };
  return {
    format: 'bpmn20',
    model: {
      $type: BPMN_TYPE.Definitions,
      id: 'Definitions',
      targetNamespace: 'https://kwitsukasa.top/workflows/builtin',
      rootElements: [
        {
          $type: BPMN_TYPE.Process,
          id: 'Process',
          name: handler.name,
          isExecutable: true,
          extensionElements: {
            $type: BPMN_TYPE.ExtensionElements,
            values: [
              {
                $type: BPMN_EXTENSION.Contract,
                body: JSON.stringify(contract),
              },
            ],
          },
          flowElements: [
            { $type: BPMN_TYPE.StartEvent, id: 'Start', name: '开始' },
            {
              $type: BPMN_TYPE.ServiceTask,
              id: 'Action',
              name: handler.name,
              implementation: KT_BPMN_STEP,
              extensionElements: {
                $type: BPMN_TYPE.ExtensionElements,
                values: [
                  { $type: BPMN_EXTENSION.Step, body: JSON.stringify(step) },
                ],
              },
            },
            { $type: BPMN_TYPE.EndEvent, id: 'End', name: '完成' },
            {
              $type: BPMN_TYPE.SequenceFlow,
              id: 'Start_Action',
              sourceRef: { $ref: 'Start' },
              targetRef: { $ref: 'Action' },
            },
            {
              $type: BPMN_TYPE.SequenceFlow,
              id: 'Action_End',
              sourceRef: { $ref: 'Action' },
              targetRef: { $ref: 'End' },
            },
          ],
        },
      ],
      diagrams: [
        {
          $type: BPMN_DI.BPMNDiagram,
          id: 'Diagram',
          plane: {
            $type: BPMN_DI.BPMNPlane,
            id: 'Plane',
            bpmnElement: { $ref: 'Process' },
            planeElement: [
              {
                $type: BPMN_DI.BPMNShape,
                id: 'Start_di',
                bpmnElement: { $ref: 'Start' },
                bounds: {
                  $type: BPMN_COORDINATE.Bounds,
                  x: 80,
                  y: 138,
                  width: 40,
                  height: 40,
                },
              },
              {
                $type: BPMN_DI.BPMNShape,
                id: 'Action_di',
                bpmnElement: { $ref: 'Action' },
                bounds: {
                  $type: BPMN_COORDINATE.Bounds,
                  x: 220,
                  y: 120,
                  width: 200,
                  height: 76,
                },
              },
              {
                $type: BPMN_DI.BPMNShape,
                id: 'End_di',
                bpmnElement: { $ref: 'End' },
                bounds: {
                  $type: BPMN_COORDINATE.Bounds,
                  x: 520,
                  y: 138,
                  width: 40,
                  height: 40,
                },
              },
            ],
          },
        },
      ],
    },
  };
}
