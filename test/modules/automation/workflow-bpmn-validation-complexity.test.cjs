const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  parseWorkflowBpmn,
  validateWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');

for (const size of [100, 500]) {
  test(`${size} 个网关共享目标时，校验以固定次数读取目标事件定义并线性访问连线`, async () => {
    const elements = [
      { $type: 'bpmn:StartEvent', id: 'start' },
      {
        $type: 'bpmn:IntermediateCatchEvent',
        id: 'shared',
        eventDefinitions: Array.from({ length: size }, (_, index) => ({
          $type: 'bpmn:TimerEventDefinition',
          id: `timer_${index}`,
          timeDuration: { $type: 'bpmn:FormalExpression', body: 'PT1S' },
        })),
      },
    ];
    for (let index = 0; index < size; index++) {
      const gateway = `gateway_${index}`;
      const receiver = `receive_${index}`;
      elements.push(
        { $type: 'bpmn:EventBasedGateway', id: gateway },
        { $type: 'bpmn:ReceiveTask', id: receiver },
      );
      for (const target of ['shared', receiver])
        elements.push({
          $type: 'bpmn:SequenceFlow',
          id: `${gateway}_${target}`,
          sourceRef: { $ref: gateway },
          targetRef: { $ref: target },
        });
    }
    const model = await parseWorkflowBpmn({
      format: 'bpmn20',
      model: {
        $type: 'bpmn:Definitions',
        id: 'definitions',
        targetNamespace: 'urn:kt:linear-validation',
        rootElements: [
          {
            $type: 'bpmn:Process',
            id: 'process',
            isExecutable: true,
            flowElements: elements,
          },
        ],
      },
    });
    let eventReads = 0;
    let flowReads = 0;
    const events = model.elements.shared.eventDefinitions;
    Object.defineProperty(model.elements.shared, 'eventDefinitions', {
      get: () => {
        eventReads++;
        return events;
      },
    });
    for (const element of Object.values(model.elements)) {
      if (element.$type !== 'bpmn:SequenceFlow') continue;
      const source = element.sourceRef;
      Object.defineProperty(element, 'sourceRef', {
        get: () => {
          flowReads++;
          return source;
        },
      });
    }
    const issues = validateWorkflowBpmn(model);
    assert.equal(
      issues.filter((issue) => issue.code === 'event-gateway-incoming').length,
      size,
    );
    assert.ok(eventReads <= 3, `重复读取事件定义 ${eventReads} 次`);
    assert.ok(flowReads <= size * 8, `重复读取连线端点 ${flowReads} 次`);
  });
}
