import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkflowDefinitionService } from '@/modules/workflow-engine/application/workflow-definition.service';
import { normalizeRuleDefinition } from '@/modules/rule-engine/domain/rule.policy';
import { ruleOutputSchema } from '@/modules/rule-engine/contract/rule-output';
import {
  BPMN_FORMAT,
  BPMN_TYPE,
  KT_BPMN_STEP,
} from '@/modules/workflow-engine/constants/bpmn';
import type { WorkflowBpmnDefinition } from '@/modules/workflow-engine/contract/workflow-bpmn.types';

const input = {
  fields: [{ key: 'enabled', label: '启用', type: 'boolean', required: true }],
};
const condition = {
  type: 'compare',
  path: 'enabled',
  operator: 'eq',
  value: true,
};
const ruleFor = (result: unknown) =>
  normalizeRuleDefinition({
    schemaVersion: 1,
    factSchema: input,
    mode: 'decision-table',
    rows: [{ id: 'row', condition, result }],
    defaultResult: result,
    testCases: [],
  });
const document = (outputSchema: object): WorkflowBpmnDefinition => ({
  format: BPMN_FORMAT,
  model: {
    $type: BPMN_TYPE.Definitions,
    id: 'definition',
    targetNamespace: 'urn:kt:rule-contract',
    rootElements: [
      {
        $type: BPMN_TYPE.Process,
        id: 'process',
        isExecutable: true,
        extensionElements: {
          $type: 'bpmn:ExtensionElements',
          values: [
            {
              $type: 'kt:Contract',
              body: JSON.stringify({
                processRef: null,
                inputSchema: input,
                outputSchema,
                output: {
                  result: { type: 'node', nodeId: 'rule', field: 'result' },
                },
                formRef: null,
                formMapping: {},
                timeoutMs: 10_000,
              }),
            },
          ],
        },
        flowElements: [
          { $type: BPMN_TYPE.StartEvent, id: 'start' },
          {
            $type: BPMN_TYPE.BusinessRuleTask,
            id: 'rule',
            implementation: KT_BPMN_STEP,
            extensionElements: {
              $type: 'bpmn:ExtensionElements',
              values: [
                {
                  $type: 'kt:Step',
                  body: JSON.stringify({
                    kind: 'rule',
                    ruleRef: { id: '1', version: 1 },
                    input: { enabled: { type: 'input', field: 'enabled' } },
                  }),
                },
              ],
            },
          },
          { $type: BPMN_TYPE.EndEvent, id: 'end' },
          {
            $type: BPMN_TYPE.SequenceFlow,
            id: 'a',
            sourceRef: { $ref: 'start' },
            targetRef: { $ref: 'rule' },
          },
          {
            $type: BPMN_TYPE.SequenceFlow,
            id: 'b',
            sourceRef: { $ref: 'rule' },
            targetRef: { $ref: 'end' },
          },
        ],
      },
    ],
  },
});
const service = (resolve: () => Promise<ReturnType<typeof ruleFor>>) =>
  new WorkflowDefinitionService(
    {} as never,
    { resolve } as never,
    {} as never,
    undefined,
  );

describe('工作流规则结果契约与异常归属', () => {
  it('同一发布版本被多个节点引用时只读取一次，下一次校验重新读取', async () => {
    const rule = ruleFor(true);
    const workflow = document(ruleOutputSchema(rule));
    const process = (
      workflow.model.rootElements as Array<{
        flowElements: Array<Record<string, unknown>>;
      }>
    )[0];
    const original = process.flowElements.find(
      (element) => element.id === 'rule',
    )!;
    const tasks = Array.from({ length: 40 }, (_, index) => ({
      ...JSON.parse(JSON.stringify(original)),
      id: `rule${index}`,
    }));
    tasks[0].id = 'rule';
    const nodes = [
      { $type: BPMN_TYPE.StartEvent, id: 'start' },
      ...tasks,
      { $type: BPMN_TYPE.EndEvent, id: 'end' },
    ];
    process.flowElements = [
      ...nodes,
      ...nodes.slice(1).map((node, index) => ({
        $type: BPMN_TYPE.SequenceFlow,
        id: `flow${index}`,
        sourceRef: { $ref: nodes[index].id },
        targetRef: { $ref: node.id },
      })),
    ];
    const resolve = jest.fn(async () => rule);
    const validator = service(resolve);
    expect((await validator.validate(workflow)).issues).toEqual([]);
    expect(resolve).toHaveBeenCalledTimes(1);
    await validator.validate(workflow);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it.each([false, 12, 'accepted'])(
    '决策结果 %p 按固定类型绑定，不能统一冒充布尔值',
    async (result) => {
      const rule = ruleFor(result);
      const output = ruleOutputSchema(rule);
      expect(output.fields[0].type).toBe(typeof result);
      expect(
        await service(async () => rule).validate(document(output)),
      ).toMatchObject({ valid: true });
      const incompatible = {
        fields: [
          { key: 'result', label: '结果', type: 'integer', required: true },
        ],
      };
      expect(
        await service(async () => rule).validate(document(incompatible)),
      ).toMatchObject({ valid: false });
    },
  );
  it('空值结果不伪造字段，缺失依赖可定位，技术故障保持原异常', async () => {
    expect(ruleOutputSchema(ruleFor(null))).toEqual({ fields: [] });
    const workflow = document(ruleOutputSchema(ruleFor(false)));
    for (const error of [
      new BadRequestException('bad rule'),
      new NotFoundException('missing rule'),
    ]) {
      expect(
        await service(async () => {
          throw error;
        }).validate(workflow),
      ).toMatchObject({ valid: false });
    }
    const unavailable = new Error('database unavailable');
    await expect(
      service(async () => {
        throw unavailable;
      }).validate(workflow),
    ).rejects.toBe(unavailable);
  });
});
