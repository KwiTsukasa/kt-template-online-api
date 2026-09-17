const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  parseWorkflowBpmn: parse,
  validateWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const parseWorkflowBpmn = async (input) => {
  const model = await parse(input);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  KT_BPMN_EXPRESSION,
} = require('../../../src/modules/workflow-engine/constants/bpmn');
const ref = (id) => ({ $ref: id });
const flow = (source, target) => ({
  $type: 'bpmn:SequenceFlow',
  id: source + '_' + target,
  sourceRef: ref(source),
  targetRef: ref(target),
});
const step = (id, extra = {}) => ({
  $type: 'bpmn:ServiceTask',
  id,
  implementation: 'https://kwitsukasa.top/schema/workflow/bpmn/1/step',
  extensionElements: {
    $type: 'bpmn:ExtensionElements',
    values: [
      {
        $type: 'kt:Step',
        body: JSON.stringify({ kind: 'script', scripts: [], input: {} }),
      },
    ],
  },
  ...extra,
});
const restore = (result) => JSON.parse(JSON.stringify(result.checkpoint));
const ids = (result) => result.jobs.map((job) => job.elementId).sort();
const finish = (model, result, names) =>
  advanceWorkflowBpmn(
    model,
    restore(result),
    {},
    result.jobs
      .filter((job) => names.includes(job.elementId))
      .map((job) => ({
        executionId: job.executionId,
        output: { receipt: job.executionId },
      })),
  );
const makeDocument = () => ({
  format: 'bpmn20',
  model: {
    $type: 'bpmn:Definitions',
    id: 'D',
    targetNamespace: 'urn:kt:compensation-subprocess',
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
            flowElements: [
              { $type: 'bpmn:StartEvent', id: 'InnerStart' },
              step('A'),
              { $type: 'bpmn:EndEvent', id: 'InnerEnd' },
              flow('InnerStart', 'A'),
              flow('A', 'InnerEnd'),
              {
                $type: 'bpmn:SubProcess',
                id: 'Handler',
                triggeredByEvent: true,
                flowElements: [
                  {
                    $type: 'bpmn:StartEvent',
                    id: 'CompensationStart',
                    isInterrupting: false,
                    eventDefinitions: [
                      { $type: 'bpmn:CompensateEventDefinition' },
                    ],
                  },
                  step('Undo'),
                  { $type: 'bpmn:EndEvent', id: 'HandlerEnd' },
                  flow('CompensationStart', 'Undo'),
                  flow('Undo', 'HandlerEnd'),
                ],
              },
            ],
          },
          step('Trigger'),
          {
            $type: 'bpmn:EndEvent',
            id: 'Throw',
            eventDefinitions: [
              {
                $type: 'bpmn:CompensateEventDefinition',
                activityRef: ref('Host'),
              },
            ],
          },
          flow('Start', 'Host'),
          flow('Host', 'Trigger'),
          flow('Trigger', 'Throw'),
        ],
      },
    ],
  },
});
test('完成子流程的补偿事件处理器可恢复执行，并使用完成时的数据快照', async () => {
  const document = makeDocument();
  const model = await parseWorkflowBpmn(document);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(ids(result), ['A']);
  result = await finish(model, result, ['A']);
  assert.deepEqual(ids(result), ['Trigger']);
  result = await finish(model, result, ['Trigger']);
  assert.deepEqual(ids(result), ['Undo']);
  assert.equal(result.jobs[0].variables.outputs.Trigger, undefined);
  assert.deepEqual(result.jobs[0].variables.input, {});
  const executionId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs[0].executionId, executionId);
  result = await finish(model, result, ['Undo']);
  assert.equal(result.status, 'succeeded');
});

for (const sequential of [true, false])
  test(`多实例子流程逐个补偿各自快照，顺序=${sequential}`, async () => {
    const document = makeDocument();
    const host = document.model.rootElements[0].flowElements.find(
      (item) => item.id === 'Host',
    );
    host.loopCharacteristics = {
      $type: 'bpmn:MultiInstanceLoopCharacteristics',
      isSequential: sequential,
      loopCardinality: { $type: 'bpmn:FormalExpression', body: '2' },
    };
    const model = await parseWorkflowBpmn(document);
    assert.deepEqual(validateWorkflowBpmn(model), []);
    let result = await advanceWorkflowBpmn(model, null, {});
    const receipts = [];
    while (result.jobs.some((job) => job.elementId === 'A')) {
      const job = result.jobs.find((job) => job.elementId === 'A');
      receipts.push(job.executionId);
      result = await advanceWorkflowBpmn(model, restore(result), {}, [
        { executionId: job.executionId, output: { receipt: job.executionId } },
      ]);
    }
    assert.equal(receipts.length, 2);
    result = await finish(model, result, ['Trigger']);
    const compensated = [];
    while (result.jobs.some((job) => job.elementId === 'Undo')) {
      assert.equal(compensated.length < 2, true);
      assert.equal(result.jobs.length, 1);
      compensated.push(result.jobs[0].variables.outputs.A.receipt);
      assert.equal(result.jobs[0].variables.outputs.Trigger, undefined);
      result = await finish(model, result, ['Undo']);
    }
    assert.deepEqual(compensated, receipts.reverse());
    assert.equal(result.status, 'succeeded');
  });

test('补偿子流程内部后续步骤继续读取隔离快照和本地补偿结果', async () => {
  const document = makeDocument();
  const host = document.model.rootElements[0].flowElements.find(
    (item) => item.id === 'Host',
  );
  const handler = host.flowElements.find((item) => item.id === 'Handler');
  handler.flowElements = handler.flowElements.filter(
    (item) => item.id !== 'Undo_HandlerEnd',
  );
  handler.flowElements.push(
    step('UndoNext'),
    flow('Undo', 'UndoNext'),
    flow('UndoNext', 'HandlerEnd'),
  );
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'Trigger', 'Undo'])
    result = await finish(model, result, [id]);
  assert.deepEqual(ids(result), ['UndoNext']);
  assert.equal(result.jobs[0].variables.outputs.Trigger, undefined);
  assert.ok(result.jobs[0].variables.outputs.Undo.receipt);
  assert.equal(result.checkpoint.outputs.Undo, undefined);
  result = await finish(model, result, ['UndoNext']);
  assert.equal(result.status, 'succeeded');
});

test('补偿事件子流程可以递归补偿宿主完成前已登记的活动', async () => {
  const document = makeDocument();
  const host = document.model.rootElements[0].flowElements.find(
    (item) => item.id === 'Host',
  );
  host.flowElements.push(step('UndoA', { isForCompensation: true }), {
    $type: 'bpmn:BoundaryEvent',
    id: 'CompA',
    attachedToRef: ref('A'),
    eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }],
  });
  host.artifacts = [
    {
      $type: 'bpmn:Association',
      id: 'LinkA',
      sourceRef: ref('CompA'),
      targetRef: ref('UndoA'),
      associationDirection: 'One',
    },
  ];
  const handler = host.flowElements.find((item) => item.id === 'Handler');
  handler.flowElements = handler.flowElements.filter(
    (item) => item.id !== 'Undo_HandlerEnd',
  );
  handler.flowElements.push(
    {
      $type: 'bpmn:IntermediateThrowEvent',
      id: 'Recursive',
      eventDefinitions: [
        { $type: 'bpmn:CompensateEventDefinition', activityRef: ref('A') },
      ],
    },
    flow('Undo', 'Recursive'),
    flow('Recursive', 'HandlerEnd'),
  );
  const model = await parseWorkflowBpmn(document);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'Trigger', 'Undo'])
    result = await finish(model, result, [id]);
  assert.deepEqual(ids(result), ['UndoA']);
  const executionId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs[0].executionId, executionId);
  result = await finish(model, result, ['UndoA']);
  assert.equal(result.status, 'succeeded');
});

test('标准循环的补偿保留每轮完成快照而不再次展开正向循环', async () => {
  const document = makeDocument();
  document.model.rootElements[0].flowElements.find(
    (item) => item.id === 'Host',
  ).loopCharacteristics = {
    $type: 'bpmn:StandardLoopCharacteristics',
    loopMaximum: 2,
    loopCondition: {
      $type: 'bpmn:FormalExpression',
      language: KT_BPMN_EXPRESSION,
      body: '{"value":true}',
    },
  };
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  const receipts = [];
  for (let index = 0; index < 2; index++) {
    receipts.push(result.jobs[0].executionId);
    result = await finish(model, result, ['A']);
  }
  result = await finish(model, result, ['Trigger']);
  for (const receipt of receipts.reverse()) {
    assert.deepEqual(ids(result), ['Undo']);
    assert.equal(result.jobs[0].variables.outputs.A.receipt, receipt);
    result = await finish(model, result, ['Undo']);
  }
  assert.equal(result.status, 'succeeded');
});

test('补偿处理器的未捕获错误使流程失败，不将错误当成成功补偿', async () => {
  const model = await parseWorkflowBpmn(makeDocument());
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'Trigger']) result = await finish(model, result, [id]);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: result.jobs[0].executionId,
      error: { code: 'UNDO_FAILED', message: 'compensation failed' },
    },
  ]);
  assert.equal(result.status, 'failed');
});

test('非等待补偿只提前放行一次出口，流程仍等待补偿处理器结束', async () => {
  const document = makeDocument();
  const elements = document.model.rootElements[0].flowElements;
  const event = elements.find((item) => item.id === 'Throw');
  event.$type = 'bpmn:IntermediateThrowEvent';
  event.eventDefinitions[0].waitForCompletion = false;
  elements.push(
    step('After'),
    { $type: 'bpmn:EndEvent', id: 'End' },
    flow('Throw', 'After'),
    flow('After', 'End'),
  );
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'Trigger']) result = await finish(model, result, [id]);
  assert.deepEqual(ids(result), ['After', 'Undo']);
  result = await finish(model, result, ['After']);
  assert.deepEqual(ids(result), ['Undo']);
  result = await finish(model, result, ['Undo']);
  assert.equal(result.status, 'succeeded');
});

test('补偿中的人工办理读取快照，恢复及提交不会污染正向结果', async () => {
  const document = makeDocument();
  const handler = document.model.rootElements[0].flowElements
    .find((item) => item.id === 'Host')
    .flowElements.find((item) => item.id === 'Handler');
  handler.flowElements = handler.flowElements.map((item) => {
    if (item.id !== 'Undo') return item;
    return {
      $type: 'bpmn:UserTask',
      id: 'Undo',
      extensionElements: {
        $type: 'bpmn:ExtensionElements',
        values: [
          {
            $type: 'kt:Step',
            body: '{"kind":"human","formRef":null,"writableFields":[],"input":{}}',
          },
        ],
      },
    };
  });
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {
    input: { task: 'business' },
  });
  for (const id of ['A', 'Trigger']) result = await finish(model, result, [id]);
  assert.deepEqual(ids(result), ['Undo']);
  assert.equal(result.jobs[0].variables.outputs.Trigger, undefined);
  assert.deepEqual(result.jobs[0].variables.input, { task: 'business' });
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs[0].variables.outputs.Trigger, undefined);
  result = await finish(model, result, ['Undo']);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.checkpoint.outputs.Undo, undefined);
});

test('正向宿主失败后不登记补偿事件子流程', async () => {
  const document = makeDocument();
  const elements = document.model.rootElements[0].flowElements;
  elements.push(
    {
      $type: 'bpmn:BoundaryEvent',
      id: 'Failure',
      attachedToRef: ref('Host'),
      eventDefinitions: [{ $type: 'bpmn:ErrorEventDefinition' }],
    },
    flow('Failure', 'Trigger'),
  );
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: result.jobs[0].executionId,
      error: { code: 'FAIL', message: 'controlled failure' },
    },
  ]);
  assert.deepEqual(ids(result), ['Trigger']);
  result = await finish(model, result, ['Trigger']);
  assert.deepEqual(ids(result), []);
  assert.equal(result.status, 'succeeded');
});

test('成功事务子流程也可使用完成快照执行其补偿事件子流程', async () => {
  const document = makeDocument();
  document.model.rootElements[0].flowElements.find(
    (item) => item.id === 'Host',
  ).$type = 'bpmn:Transaction';
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'Trigger']) result = await finish(model, result, [id]);
  assert.deepEqual(ids(result), ['Undo']);
  result = await finish(model, result, ['Undo']);
  assert.equal(result.status, 'succeeded');
});

test('同时抛出的补偿不能重复领取同一多实例宿主的剩余快照', async () => {
  const document = makeDocument();
  const elements = document.model.rootElements[0].flowElements;
  elements.find((item) => item.id === 'Host').loopCharacteristics = {
    $type: 'bpmn:MultiInstanceLoopCharacteristics',
    isSequential: true,
    loopCardinality: { $type: 'bpmn:FormalExpression', body: '2' },
  };
  const hostOut = elements.find((item) => item.id === 'Host_Trigger');
  hostOut.targetRef = ref('Fork');
  elements.push(
    { $type: 'bpmn:ParallelGateway', id: 'Fork' },
    step('Other'),
    {
      $type: 'bpmn:EndEvent',
      id: 'OtherThrow',
      eventDefinitions: [
        { $type: 'bpmn:CompensateEventDefinition', activityRef: ref('Host') },
      ],
    },
    flow('Fork', 'Trigger'),
    flow('Fork', 'Other'),
    flow('Other', 'OtherThrow'),
  );
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const id of ['A', 'A', 'Trigger', 'Other'])
    result = await finish(model, result, [id]);
  assert.notEqual(result.status, 'failed');
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(ids(result), ['Undo']);
    result = await finish(model, result, ['Undo']);
  }
  assert.equal(result.status, 'succeeded');
});

test('完成宿主后立即抛出补偿，不因宿主尚在离开事件栈内而失败', async () => {
  const document = makeDocument();
  const process = document.model.rootElements[0];
  process.flowElements = process.flowElements.filter(
    (item) => !['Trigger', 'Host_Trigger', 'Trigger_Throw'].includes(item.id),
  );
  process.flowElements.push(flow('Host', 'Throw'));
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['A']);
  assert.notEqual(result.status, 'failed');
  assert.deepEqual(ids(result), ['Undo']);
  result = await finish(model, result, ['Undo']);
  assert.equal(result.status, 'succeeded');
});

test('多实例宿主整体未完成时不会被补偿重新启动', async () => {
  const document = makeDocument();
  const process = document.model.rootElements[0];
  const host = process.flowElements.find((item) => item.id === 'Host');
  host.loopCharacteristics = {
    $type: 'bpmn:MultiInstanceLoopCharacteristics',
    isSequential: true,
    loopCardinality: { $type: 'bpmn:FormalExpression', body: '2' },
  };
  process.flowElements = process.flowElements.filter(
    (item) => !['Start_Host', 'Host_Trigger'].includes(item.id),
  );
  process.flowElements.push(
    { $type: 'bpmn:ParallelGateway', id: 'Fork' },
    { $type: 'bpmn:EndEvent', id: 'NormalEnd' },
    flow('Start', 'Fork'),
    flow('Fork', 'Host'),
    flow('Fork', 'Trigger'),
    flow('Host', 'NormalEnd'),
  );
  const model = await parseWorkflowBpmn(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['A']);
  result = await finish(model, result, ['Trigger']);
  assert.notEqual(result.status, 'failed');
  assert.deepEqual(ids(result), ['A']);
  result = await finish(model, result, ['A']);
  assert.equal(result.status, 'succeeded');
});
