const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, validateWorkflowBpmn } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const adapter = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn-boundary');
const ref = id => ({ $ref: id });
const flow = (source, target) => ({ $type: 'bpmn:SequenceFlow', id: source + '_' + target, sourceRef: ref(source), targetRef: ref(target) });
const step = (id, human = false, extra = {}) => ({ $type: human ? 'bpmn:UserTask' : 'bpmn:ServiceTask', id,
  ...!human && { implementation: 'https://kwitsukasa.top/schema/workflow/bpmn/1/step' },
  extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: JSON.stringify(human ? { kind: 'human', formRef: null, writableFields: [], input: {} } : { kind: 'script', scripts: [], input: {} }) }] }, ...extra });
const restore = result => JSON.parse(JSON.stringify(result.checkpoint));
const finish = (model, result, jobs = result.jobs) => advanceWorkflowBpmn(model, restore(result), {}, jobs.map(job => ({ executionId: job.executionId, output: { receipt: job.executionId } })));
const makeModel = async (human = false) => {
  const transaction = { $type: 'bpmn:Transaction', id: 'Tx', flowElements: [
    { $type: 'bpmn:StartEvent', id: 'TxStart' }, { $type: 'bpmn:ParallelGateway', id: 'Fork' }, step('A'), step('B'), step('Host', human), step('Trigger'),
    step('Undo', human, { isForCompensation: true }),
    { $type: 'bpmn:BoundaryEvent', id: 'Compensation', attachedToRef: ref('Host'), eventDefinitions: [{ $type: 'bpmn:CompensateEventDefinition' }] },
    { $type: 'bpmn:BoundaryEvent', id: 'HostError', attachedToRef: ref('Host'), eventDefinitions: [{ $type: 'bpmn:ErrorEventDefinition' }] },
    { $type: 'bpmn:EndEvent', id: 'TxEnd' }, { $type: 'bpmn:EndEvent', id: 'Cancel', eventDefinitions: [{ $type: 'bpmn:CancelEventDefinition' }] },
    flow('TxStart', 'Fork'), flow('Fork', 'A'), flow('Fork', 'B'), flow('Fork', 'Trigger'), flow('A', 'Host'), flow('B', 'Host'), flow('Host', 'TxEnd'), flow('HostError', 'TxEnd'), flow('Trigger', 'Cancel'),
  ], artifacts: [{ $type: 'bpmn:Association', id: 'UndoLink', sourceRef: ref('Compensation'), targetRef: ref('Undo'), associationDirection: 'One' }] };
  const model = await parseWorkflowBpmn({ format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'urn:kt:compensation-instance', rootElements: [{ $type: 'bpmn:Process', id: 'Process', isExecutable: true, flowElements: [
    { $type: 'bpmn:StartEvent', id: 'Start' }, transaction,
    { $type: 'bpmn:BoundaryEvent', id: 'Cancelled', attachedToRef: ref('Tx'), eventDefinitions: [{ $type: 'bpmn:CancelEventDefinition' }] },
    step('Recovered'), { $type: 'bpmn:EndEvent', id: 'End' }, flow('Start', 'Tx'), flow('Tx', 'End'), flow('Cancelled', 'Recovered'), flow('Recovered', 'End'),
  ] }] } });
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const start = async model => {
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result, result.jobs.filter(job => ['A', 'B'].includes(job.elementId)));
  assert.equal(result.jobs.filter(job => job.elementId === 'Host').length, 2);
  return result;
};
const cancelAndCompensate = async (model, result, expected) => {
  result = await finish(model, result, result.jobs.filter(job => job.elementId === 'Trigger'));
  const compensations = result.jobs.filter(job => job.elementId === 'Undo').map(job => job.executionId).sort();
  assert.equal(compensations.length, expected, '补偿数量必须等于成功的宿主实例数');
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(result.jobs.filter(job => job.elementId === 'Undo').map(job => job.executionId).sort(), compensations);
  for (const executionId of compensations) result = await finish(model, result, result.jobs.filter(job => job.executionId === executionId));
  assert.deepEqual(result.jobs.map(job => job.elementId), ['Recovered']);
  result = await finish(model, result);
  assert.equal(result.status, 'succeeded');
};

for (const human of [false, true]) for (const completed of [0, 1, 2]) {
  test(`${human ? '人工' : '服务'}任务两个并发实例中${completed}个完成：仅补偿成功实例，恢复不重复执行`, async () => {
    const model = await makeModel(human);
    let result = await start(model);
    const hostIds = result.jobs.filter(job => job.elementId === 'Host').slice(0, completed).map(job => job.executionId);
    for (const executionId of hostIds) result = await finish(model, result, result.jobs.filter(job => job.executionId === executionId));
    await cancelAndCompensate(model, result, completed);
  });
}

test('一个宿主被错误边界撤销后，事务只补偿另一个成功的宿主', async () => {
  const model = await makeModel();
  let result = await start(model);
  const host = result.jobs.find(job => job.elementId === 'Host');
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: host.executionId, error: { code: 'BAD', message: 'rejected' } }]);
  result = await finish(model, result, result.jobs.filter(job => job.elementId === 'Host'));
  await cancelAndCompensate(model, result, 1);
});

test('旧版已保存的补偿队列过滤容器完成，保留两个成功实例及其原生回执', async () => {
  const model = await makeModel();
  const current = adapter.WorkflowCompensateEventDefinition;
  let result;
  try {
    adapter.WorkflowCompensateEventDefinition = require('bpmn-elements').CompensateEventDefinition;
    result = await start(model);
    result = await finish(model, result, result.jobs.filter(job => job.elementId === 'Host'));
  } finally { adapter.WorkflowCompensateEventDefinition = current; }
  const persisted = JSON.stringify(result.checkpoint);
  assert.ok(persisted.includes('compensate-q'));
  await cancelAndCompensate(model, result, 2);
  assert.equal(JSON.stringify(result.checkpoint), persisted);
});
