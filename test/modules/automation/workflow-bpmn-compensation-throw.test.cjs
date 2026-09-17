const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  parseWorkflowBpmn,
  validateWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
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
const makeModel = async (target = 'A', wait = true) => {
  const event = {
    $type: 'bpmn:CompensateEventDefinition',
    waitForCompletion: wait,
  };
  if (target) event.activityRef = ref(target);
  const process = {
    $type: 'bpmn:Process',
    id: 'Process',
    isExecutable: true,
    flowElements: [
      { $type: 'bpmn:StartEvent', id: 'Start' },
      step('A'),
      step('B'),
      step('UndoA', { isForCompensation: true }),
      step('UndoB', { isForCompensation: true }),
      {
        $type: 'bpmn:BoundaryEvent',
        id: 'CompA',
        attachedToRef: ref('A'),
        eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }],
      },
      {
        $type: 'bpmn:BoundaryEvent',
        id: 'CompB',
        attachedToRef: ref('B'),
        eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }],
      },
      {
        $type: 'bpmn:IntermediateThrowEvent',
        id: 'Throw',
        eventDefinitions: [event],
      },
      step('After'),
      { $type: 'bpmn:EndEvent', id: 'End' },
      flow('Start', 'A'),
      flow('A', 'B'),
      flow('B', 'Throw'),
      flow('Throw', 'After'),
      flow('After', 'End'),
    ],
    artifacts: ['A', 'B'].map((id) => ({
      $type: 'bpmn:Association',
      id: 'Link' + id,
      sourceRef: ref('Comp' + id),
      targetRef: ref('Undo' + id),
      associationDirection: 'One',
    })),
  };
  const model = await parseWorkflowBpmn({
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions',
      id: 'Definitions',
      targetNamespace: 'urn:kt:compensation-throw',
      rootElements: [process],
    },
  });
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const start = async (model) => {
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['A']);
  return finish(model, result, ['B']);
};

for (const rounds of [1, 3])
  test(`回环图执行 ${rounds} 轮后逐实例逆序补偿，恢复不重新派发已完成的处理器`, async () => {
    const document = (await makeModel(null)).definition;
    const process = document.model.rootElements[0];
    process.flowElements = process.flowElements.filter(
      (item) => item.id !== 'B_Throw',
    );
    process.flowElements.push(
      {
        $type: 'bpmn:ExclusiveGateway',
        id: 'Repeat',
        default: ref('Repeat_Throw'),
      },
      flow('B', 'Repeat'),
      flow('Repeat', 'Throw'),
      {
        ...flow('Repeat', 'A'),
        conditionExpression: {
          $type: 'bpmn:FormalExpression',
          language: 'https://kwitsukasa.top/schema/workflow/bpmn/1/expression',
          body: JSON.stringify({ path: 'outputs.B.again' }),
        },
      },
    );
    const model = await parseWorkflowBpmn(document);
    assert.deepEqual(validateWorkflowBpmn(model), []);
    let result = await advanceWorkflowBpmn(model, null, {});
    for (let index = 0; index < rounds; index++) {
      assert.deepEqual(ids(result), ['A']);
      result = await finish(model, result, ['A']);
      assert.deepEqual(ids(result), ['B']);
      result = await advanceWorkflowBpmn(model, restore(result), {}, [
        {
          executionId: result.jobs[0].executionId,
          output: { again: index + 1 < rounds },
        },
      ]);
    }
    for (let index = 0; index < rounds; index++) {
      assert.deepEqual(ids(result), ['UndoB']);
      result = await finish(model, result, ['UndoB']);
      assert.deepEqual(ids(result), ['UndoA']);
      result = await finish(model, result, ['UndoA']);
    }
    assert.deepEqual(ids(result), ['After']);
    result = await finish(model, result, ['After']);
    assert.equal(result.status, 'succeeded');
  });

test('定向补偿只派发指定活动，默认等待补偿完成才进入后续步骤，重启保留身份', async () => {
  const model = await makeModel();
  let result = await start(model);
  assert.deepEqual(ids(result), ['UndoA']);
  const executionId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs[0].executionId, executionId);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['After']);
  result = await finish(model, result, ['After']);
  assert.equal(result.status, 'succeeded');
});

test('waitForCompletion=false 显式允许后续并行，流程仍等待已派发的补偿完成', async () => {
  const model = await makeModel('A', false);
  let result = await start(model);
  assert.deepEqual(ids(result), ['After', 'UndoA']);
  result = await finish(model, result, ['After']);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.equal(result.status, 'succeeded');
});

test('未指定活动时按顺序依赖逆序补偿，重启保留尚未派发的补偿阶段', async () => {
  const model = await makeModel(null);
  let result = await start(model);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['After']);
  result = await finish(model, result, ['After']);
  assert.equal(result.status, 'succeeded');
});

test('没有已完成的目标活动时补偿为空操作，不为未来活动派发补偿', async () => {
  const model = await makeModel('After');
  let result = await start(model);
  assert.deepEqual(ids(result), ['After']);
  result = await finish(model, result, ['After']);
  assert.equal(result.status, 'succeeded');
});

test('补偿失败时不提前派发后续步骤，保持未捕获错误的失败结果', async () => {
  const model = await makeModel();
  let result = await start(model);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: result.jobs[0].executionId,
      error: { code: 'UNDO_FAILED', message: 'undo rejected' },
    },
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'undo rejected');
  assert.ok(
    !result.transitions.some(
      (event) =>
        event.elementId === 'After' && event.event === 'activity.enter',
    ),
  );
});

test('非等待的全局补偿仍按依赖逆序处理，跨恢复不会再次传播后续出口', async () => {
  const model = await makeModel(null, false);
  let result = await start(model);
  assert.deepEqual(ids(result), ['After', 'UndoB']);
  result = await finish(model, result, ['After']);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.equal(result.status, 'succeeded');
});

test('无依赖的并行活动可以并行补偿，全部结束才继续', async () => {
  const document = (await makeModel(null)).definition;
  const process = document.model.rootElements[0];
  process.flowElements = process.flowElements.filter(
    (item) => !['Start_A', 'A_B', 'B_Throw'].includes(item.id),
  );
  process.flowElements.push(
    { $type: 'bpmn:ParallelGateway', id: 'Fork' },
    { $type: 'bpmn:ParallelGateway', id: 'Join' },
    flow('Start', 'Fork'),
    flow('Fork', 'A'),
    flow('Fork', 'B'),
    flow('A', 'Join'),
    flow('B', 'Join'),
    flow('Join', 'Throw'),
  );
  const model = await parseWorkflowBpmn(document);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['A', 'B']);
  assert.deepEqual(ids(result), ['UndoA', 'UndoB']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['After']);
});

for (const wait of [true, false])
  test(`补偿结束事件 waitForCompletion=${wait} 保留处理器身份并完成流程`, async () => {
    const document = (await makeModel('A', wait)).definition;
    const process = document.model.rootElements[0];
    process.flowElements = process.flowElements.filter(
      (item) => !['After', 'End', 'Throw_After', 'After_End'].includes(item.id),
    );
    process.flowElements.find((item) => item.id === 'Throw').$type =
      'bpmn:EndEvent';
    const model = await parseWorkflowBpmn(document);
    assert.deepEqual(validateWorkflowBpmn(model), []);
    let result = await start(model);
    assert.deepEqual(ids(result), ['UndoA']);
    const executionId = result.jobs[0].executionId;
    result = await advanceWorkflowBpmn(model, restore(result), {});
    assert.equal(result.jobs[0].executionId, executionId);
    result = await finish(model, result, ['UndoA']);
    assert.equal(result.status, 'succeeded');
  });

test('子流程抛出的无目标补偿只处理子流程实例，不能补偿父作用域的活动', async () => {
  const document = (await makeModel(null)).definition;
  const process = document.model.rootElements[0];
  const innerIds = ['B', 'UndoB', 'CompB', 'Throw', 'B_Throw'];
  const inner = {
    $type: 'bpmn:SubProcess',
    id: 'Inner',
    flowElements: [
      { $type: 'bpmn:StartEvent', id: 'InnerStart' },
      ...process.flowElements.filter((item) => innerIds.includes(item.id)),
      { $type: 'bpmn:EndEvent', id: 'InnerEnd' },
      flow('InnerStart', 'B'),
      flow('Throw', 'InnerEnd'),
    ],
    artifacts: process.artifacts.filter((item) => item.id === 'LinkB'),
  };
  process.flowElements = process.flowElements.filter(
    (item) =>
      !innerIds.includes(item.id) && !['A_B', 'Throw_After'].includes(item.id),
  );
  process.flowElements.push(inner, flow('A', 'Inner'), flow('Inner', 'After'));
  process.artifacts = process.artifacts.filter((item) => item.id === 'LinkA');
  const model = await parseWorkflowBpmn(document);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await start(model);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['After']);
  result = await finish(model, result, ['After']);
  assert.equal(result.status, 'succeeded');
});
