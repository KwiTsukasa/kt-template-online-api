const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, validateWorkflowBpmn } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const ref = id => ({ $ref: id });
const flow = (source, target) => ({ $type: 'bpmn:SequenceFlow', id: source + '_' + target, sourceRef: ref(source), targetRef: ref(target) });
const step = (id, extra = {}) => ({ $type: 'bpmn:ServiceTask', id, implementation: 'https://kwitsukasa.top/schema/workflow/bpmn/1/step', extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: JSON.stringify({ kind: 'script', scripts: [], input: {} }) }] }, ...extra });
const restore = result => JSON.parse(JSON.stringify(result.checkpoint));
const ids = result => result.jobs.map(job => job.elementId).sort();
const finish = (model, result, names) => advanceWorkflowBpmn(model, restore(result), {}, result.jobs.filter(job => names.includes(job.elementId)).map(job => ({ executionId: job.executionId, output: { receipt: job.executionId } })));
const makeDocument = () => ({ format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'urn:kt:transaction-compensation', rootElements: [{ $type: 'bpmn:Process', id: 'Process', isExecutable: true, flowElements: [
  { $type: 'bpmn:StartEvent', id: 'Start' },
  { $type: 'bpmn:Transaction', id: 'Transaction', flowElements: [
    { $type: 'bpmn:StartEvent', id: 'InnerStart' }, step('A'), step('B'), step('Trigger'),
    step('UndoA', { isForCompensation: true }), step('UndoB', { isForCompensation: true }),
    { $type: 'bpmn:BoundaryEvent', id: 'CompA', attachedToRef: ref('A'), eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }] },
    { $type: 'bpmn:BoundaryEvent', id: 'CompB', attachedToRef: ref('B'), eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }] },
    { $type: 'bpmn:EndEvent', id: 'Cancel', eventDefinitions: [{ $type: 'bpmn:CancelEventDefinition' }] },
    flow('InnerStart', 'A'), flow('A', 'B'), flow('B', 'Trigger'), flow('Trigger', 'Cancel'),
  ], artifacts: ['A', 'B'].map(id => ({ $type: 'bpmn:Association', id: 'Link' + id, sourceRef: ref('Comp' + id), targetRef: ref('Undo' + id), associationDirection: 'One' })) },
  { $type: 'bpmn:BoundaryEvent', id: 'Cancelled', attachedToRef: ref('Transaction'), eventDefinitions: [{ $type: 'bpmn:CancelEventDefinition' }] },
  step('Recovered'), { $type: 'bpmn:EndEvent', id: 'End' }, flow('Start', 'Transaction'), flow('Transaction', 'End'), flow('Cancelled', 'Recovered'), flow('Recovered', 'End'),
] }] } });
const makeModel = async document => {
  const model = await parseWorkflowBpmn(document ?? makeDocument());
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const start = async model => {
  let result = await advanceWorkflowBpmn(model, null, {});
  for (const name of ['A', 'B', 'Trigger']) result = await finish(model, result, [name]);
  return result;
};

test('自动事务取消按依赖逆序补偿，恢复保留等待身份，补偿完成后才进入取消出口', async () => {
  const model = await makeModel();
  let result = await start(model);
  assert.deepEqual(ids(result), ['UndoB']);
  const executionId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs[0].executionId, executionId);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['Recovered']);
  result = await finish(model, result, ['Recovered']);
  assert.equal(result.status, 'succeeded');
});

test('无顺序依赖的活动并行补偿，全部结束才进入取消出口', async () => {
  const document = makeDocument();
  const transaction = document.model.rootElements[0].flowElements.find(item => item.id === 'Transaction');
  transaction.flowElements = transaction.flowElements.filter(item => !['InnerStart_A', 'A_B', 'B_Trigger'].includes(item.id));
  transaction.flowElements.push({ $type: 'bpmn:ParallelGateway', id: 'Fork' }, { $type: 'bpmn:ParallelGateway', id: 'Join' }, flow('InnerStart', 'Fork'), flow('Fork', 'A'), flow('Fork', 'B'), flow('A', 'Join'), flow('B', 'Join'), flow('Join', 'Trigger'));
  const model = await makeModel(document);
  let result = await start(model);
  assert.deepEqual(ids(result), ['UndoA', 'UndoB']);
  result = await finish(model, result, ['UndoB']);
  assert.deepEqual(ids(result), ['UndoA']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['Recovered']);
});

test('事务取消立即撤销还在执行的同级活动，补偿等待不允许该活动继续', async () => {
  const document = makeDocument();
  const transaction = document.model.rootElements[0].flowElements.find(item => item.id === 'Transaction');
  transaction.flowElements = transaction.flowElements.filter(item => item.id !== 'B_Trigger');
  transaction.flowElements.push(step('Running'), { $type: 'bpmn:ParallelGateway', id: 'Fork' }, { $type: 'bpmn:EndEvent', id: 'OtherEnd' }, flow('B', 'Fork'), flow('Fork', 'Trigger'), flow('Fork', 'Running'), flow('Running', 'OtherEnd'));
  const model = await makeModel(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['A']);
  result = await finish(model, result, ['B']);
  const running = result.jobs.find(job => job.elementId === 'Running');
  assert.ok(running);
  result = await finish(model, result, ['Trigger']);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: running.executionId, output: { late: true } }]);
  assert.deepEqual(result.unconsumedCompletionIds, [running.executionId]);
  assert.deepEqual(ids(result), ['UndoB']);
  result = await finish(model, result, ['UndoB']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['Recovered']);
});

test('事务补偿失败保持失败结果，不能进入取消恢复路径或派发前序补偿', async () => {
  const model = await makeModel();
  let result = await start(model);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: result.jobs[0].executionId, error: { code: 'UNDO_FAILED', message: 'undo rejected' } }]);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'undo rejected');
  assert.ok(!result.transitions.some(item => ['UndoA', 'Recovered'].includes(item.elementId) && item.event === 'activity.enter'));
});

test('事务补偿错误可由事务外的错误边界捕获，不误走取消出口', async () => {
  const document = makeDocument();
  document.model.rootElements[0].flowElements.push(
    { $type: 'bpmn:BoundaryEvent', id: 'Fault', attachedToRef: ref('Transaction'), eventDefinitions: [{ $type: 'bpmn:ErrorEventDefinition' }] },
    step('HandleFault'), flow('Fault', 'HandleFault'), flow('HandleFault', 'End'),
  );
  const model = await makeModel(document);
  let result = await start(model);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: result.jobs[0].executionId, error: { code: 'UNDO_FAILED', message: 'undo rejected' } }]);
  assert.deepEqual(ids(result), ['HandleFault']);
  result = await finish(model, result, ['HandleFault']);
  assert.equal(result.status, 'succeeded');
});

test('正常完成的事务不启动补偿也不走取消出口', async () => {
  const document = makeDocument();
  const transaction = document.model.rootElements[0].flowElements.find(item => item.id === 'Transaction');
  delete transaction.flowElements.find(item => item.id === 'Cancel').eventDefinitions;
  const model = await makeModel(document);
  const result = await start(model);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(ids(result), []);
  assert.ok(!result.transitions.some(item => ['UndoA', 'UndoB', 'Recovered'].includes(item.elementId) && item.event === 'activity.enter'));
});

test('没有成功补偿候选的取消不留下悬空等待', async () => {
  const document = makeDocument();
  const transaction = document.model.rootElements[0].flowElements.find(item => item.id === 'Transaction');
  transaction.flowElements = transaction.flowElements.filter(item => !['InnerStart_A', 'A_B', 'B_Trigger'].includes(item.id));
  transaction.flowElements.push(flow('InnerStart', 'Trigger'));
  const model = await makeModel(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, ['Trigger']);
  assert.deepEqual(ids(result), ['Recovered']);
  result = await finish(model, result, ['Recovered']);
  assert.equal(result.status, 'succeeded');
});

test('回环事务按实际完成顺序逐实例逆序补偿，阶段切换不丢失剩余边界', async () => {
  const document = makeDocument();
  const transaction = document.model.rootElements[0].flowElements.find(item => item.id === 'Transaction');
  transaction.flowElements = transaction.flowElements.filter(item => item.id !== 'B_Trigger');
  transaction.flowElements.push({ $type: 'bpmn:ExclusiveGateway', id: 'Repeat', default: ref('Repeat_Trigger') }, flow('B', 'Repeat'), flow('Repeat', 'Trigger'), {
    ...flow('Repeat', 'A'), conditionExpression: { $type: 'bpmn:FormalExpression', language: 'https://kwitsukasa.top/schema/workflow/bpmn/1/expression', body: JSON.stringify({ path: 'outputs.B.again' }) },
  });
  const model = await makeModel(document);
  let result = await advanceWorkflowBpmn(model, null, {});
  for (let index = 0; index < 3; index++) {
    result = await finish(model, result, ['A']);
    result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: result.jobs[0].executionId, output: { again: index < 2 } }]);
  }
  result = await finish(model, result, ['Trigger']);
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(ids(result), ['UndoB']);
    result = await finish(model, result, ['UndoB']);
    assert.deepEqual(ids(result), ['UndoA']);
    result = await finish(model, result, ['UndoA']);
  }
  assert.deepEqual(ids(result), ['Recovered']);
  result = await finish(model, result, ['Recovered']);
  assert.equal(result.status, 'succeeded');
});

for (const cancelled of [false, true]) test(`旧原生事务检查点取消状态=${cancelled} 恢复已有工作身份并完成`, async () => {
  const adapter = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn-transaction');
  const { Transaction } = require('bpmn-elements');
  const factory = adapter.WorkflowTransaction;
  const model = await makeModel();
  let result;
  adapter.WorkflowTransaction = Transaction;
  try {
    result = await advanceWorkflowBpmn(model, null, {});
    result = await finish(model, result, ['A']);
    result = await finish(model, result, ['B']);
    if (cancelled) result = await finish(model, result, ['Trigger']);
  } finally { adapter.WorkflowTransaction = factory; }
  const previous = result.jobs.map(job => job.executionId).sort();
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(result.jobs.map(job => job.executionId).sort(), previous);
  if (!cancelled) {
    result = await finish(model, result, ['Trigger']);
    assert.deepEqual(ids(result), ['UndoB']);
  }
  result = await finish(model, result, ['UndoB']);
  result = await finish(model, result, ['UndoA']);
  assert.deepEqual(ids(result), ['Recovered']);
  result = await finish(model, result, ['Recovered']);
  assert.equal(result.status, 'succeeded');
});
