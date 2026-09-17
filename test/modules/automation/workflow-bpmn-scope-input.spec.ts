import { KT_BPMN_STEP } from '@/modules/workflow-engine/constants/bpmn';
import type { EntityManager } from 'typeorm';
import type { RuleEnginePort } from '@/modules/rule-engine/contract/rule.types';
import type { TaskExecutionPort } from '@/modules/task-execution/contract/task-execution.port';
import { WorkflowBpmnExecutionService } from '@/modules/workflow-engine/application/workflow-bpmn-execution.service';
import type { WorkflowProcessRegistry } from '@/modules/workflow-engine/application/workflow-process.registry';
import type { WorkflowScriptExecutionService } from '@/modules/workflow-engine/application/workflow-script-execution.service';
import { type WorkflowBpmnDefinition } from '@/modules/workflow-engine/contract/workflow-bpmn.types';
import { WorkflowBpmnActivity } from '@/modules/workflow-engine/infrastructure/persistence/workflow-bpmn.entity';
import { WorkflowRun } from '@/modules/workflow-engine/infrastructure/persistence/workflow-run.entities';

const ref = (id: string) => ({ $ref: id });
const flow = (source: string, target: string) => ({
  $type: 'bpmn:SequenceFlow',
  id: source + '_' + target,
  sourceRef: ref(source),
  targetRef: ref(target),
});

describe('BPMN 活动派发的作用域输入', () => {
  it.each(['rule', 'action', 'human', 'business', 'script'])(
    '%s 使用保存的子流程实例输入，不读取根流程同名字段',
    async (kind) => {
      const binding = { index: { type: 'input', field: 'index' } };
      const step = {
        kind,
        input: binding,
        ruleRef: { id: 'rule', version: 1 },
        taskRef: { id: 'task', version: 1 },
        stepKey: 'example.step',
        scripts: [],
        formRef: null,
        writableFields: [],
      };
      let activityType = 'bpmn:ServiceTask';
      if (kind === 'human') activityType = 'bpmn:UserTask';
      const definition: WorkflowBpmnDefinition = {
        format: 'bpmn20',
        model: {
          $type: 'bpmn:Definitions',
          id: 'D',
          targetNamespace: 'urn:kt:scope-input',
          rootElements: [
            {
              $type: 'bpmn:Process',
              id: 'P',
              isExecutable: true,
              flowElements: [
                { $type: 'bpmn:StartEvent', id: 'Start' },
                {
                  $type: 'bpmn:SubProcess',
                  id: 'Host',
                  loopCharacteristics: {
                    $type: 'bpmn:MultiInstanceLoopCharacteristics',
                    isSequential: false,
                    loopCardinality: {
                      $type: 'bpmn:FormalExpression',
                      body: '2',
                    },
                  },
                  flowElements: [
                    { $type: 'bpmn:StartEvent', id: 'InnerStart' },
                    {
                      $type: activityType,
                      id: 'Step',
                      implementation: KT_BPMN_STEP,
                      extensionElements: {
                        $type: 'bpmn:ExtensionElements',
                        values: [
                          { $type: 'kt:Step', body: JSON.stringify(step) },
                        ],
                      },
                    },
                    { $type: 'bpmn:EndEvent', id: 'InnerEnd' },
                    flow('InnerStart', 'Step'),
                    flow('Step', 'InnerEnd'),
                  ],
                },
                { $type: 'bpmn:EndEvent', id: 'End' },
                flow('Start', 'Host'),
                flow('Host', 'End'),
              ],
            },
          ],
        },
      };
      if (kind === 'human') {
        const process = definition.model.rootElements as Array<{
          flowElements: Array<{
            id: string;
            flowElements?: Array<Record<string, unknown>>;
          }>;
        }>;
        delete process[0].flowElements
          .find((item) => item.id === 'Host')!
          .flowElements!.find((item) => item.id === 'Step')!.implementation;
      }
      const run = Object.assign(new WorkflowRun(), {
        id: '123',
        deadlineAt: new Date(Date.now() + 60_000),
        inputValues: { index: 999 },
        bpmnState: null,
        businessContext: {
          processRef: { key: 'example.business', version: 1 },
        },
      });
      const activities: WorkflowBpmnActivity[] = [];
      const manager = {
        findBy: async () => activities.slice(),
        findOneByOrFail: async () => run,
        findOne: async () => run,
        create: (_entity: unknown, input: Partial<WorkflowBpmnActivity>) =>
          Object.assign(new WorkflowBpmnActivity(), input),
        save: jest.fn(
          async (
            _entity: unknown,
            value: WorkflowBpmnActivity | WorkflowBpmnActivity[],
          ) => {
            if (Array.isArray(value))
              activities.splice(0, activities.length, ...value);
          },
        ),
        update: jest.fn(
          async (
            _entity: unknown,
            _where: unknown,
            patch: Partial<WorkflowRun>,
          ) => {
            Object.assign(run, patch);
          },
        ),
        transaction: async (
          action: (manager: EntityManager) => Promise<void>,
        ) => action(manager as unknown as EntityManager),
      };
      const rules = { evaluate: jest.fn().mockResolvedValue({ result: true }) };
      const tasks = {
        start: jest.fn().mockResolvedValue({ runId: 'child' }),
        read: jest
          .fn()
          .mockResolvedValue({ status: 'succeeded', output: {}, error: null }),
      };
      const process = {
        prepareStep: jest.fn().mockResolvedValue({}),
        acceptStep: jest.fn().mockResolvedValue({}),
      };
      const processes = { resolve: () => process };
      const scripts = {
        advance: jest
          .fn()
          .mockResolvedValue({ status: 'succeeded', results: [] }),
      };
      const service = new WorkflowBpmnExecutionService(
        processes as unknown as WorkflowProcessRegistry,
        rules as unknown as RuleEnginePort,
        scripts as unknown as WorkflowScriptExecutionService,
        tasks as unknown as TaskExecutionPort,
      );
      await service.process(
        run,
        definition,
        manager as unknown as EntityManager,
      );
      let inputs: unknown[];
      if (kind === 'rule')
        inputs = rules.evaluate.mock.calls.map((call) => call[1]);
      else if (kind === 'action')
        inputs = tasks.start.mock.calls.map((call) => call[0].input);
      else if (kind === 'human')
        inputs = activities.map((activity) => activity.state.preparedInput);
      else inputs = process.prepareStep.mock.calls.map((call) => call[0].input);
      expect(inputs).toEqual([{ index: 0 }, { index: 1 }]);
      expect(run.inputValues).toEqual({ index: 999 });
    },
  );
});
