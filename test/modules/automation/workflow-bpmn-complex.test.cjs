const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, validateWorkflowBpmn, exportWorkflowBpmnXml, importWorkflowBpmnXml } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const { KT_BPMN_EXPRESSION } = require('../../../src/modules/workflow-engine/contract/workflow-bpmn.types');
const { evaluateBpmnExpression } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-expression');
const formal = value => ({ $type: 'bpmn:FormalExpression', language: KT_BPMN_EXPRESSION, body: JSON.stringify(value) });
const flow = (source, target, condition) => {
  const result = { $type: 'bpmn:SequenceFlow', id: source + '_' + target, sourceRef: { $ref: source }, targetRef: { $ref: target } };
  if (condition) result.conditionExpression = formal(condition);
  return result;
};
const human = id => ({ $type: 'bpmn:UserTask', id, extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: '{"kind":"human","formRef":null,"writableFields":[],"input":{}}' }] } });
const restore = result => JSON.parse(JSON.stringify(result.checkpoint));
const complete = (result, id) => ({ executionId: result.jobs.find(job => job.elementId === id).executionId, output: {} });

/**
 * 构造三条独立人工分支和二取三复杂汇合，出口仅在激活阶段放行。
 * @param required - 当前阶段要求的入口令牌数。
 * @returns 可验证发布、恢复和 XML 往返的纯 JSON 模型。
 */
function definition(required = 2) {
  return { format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'urn:kt:complex', rootElements: [
    { $type: 'bpmn:Process', id: 'Process', isExecutable: true, flowElements: [
      { $type: 'bpmn:StartEvent', id: 'Start' }, { $type: 'bpmn:ParallelGateway', id: 'Fork' },
      ...['A', 'B', 'C'].map(human),
      { $type: 'bpmn:ComplexGateway', id: 'Join', activationCondition: formal({ op: 'gte', left: { op: 'sum', values: ['A', 'B', 'C'].map(id => ({ path: 'content.activationCount.' + id + '_Join' })) }, right: { value: required } }) },
      human('Next'), { $type: 'bpmn:EndEvent', id: 'End' }, flow('Start', 'Fork'),
      ...['A', 'B', 'C'].flatMap(id => [flow('Fork', id), flow(id, 'Join')]),
      flow('Join', 'Next', { path: 'content.waitingForStart' }), flow('Next', 'End'),
    ] },
  ] } };
}

test('二取三激活只放行一次，晚到分支重置，JSON 恢复不重复发出活动', async () => {
  const model = await parseWorkflowBpmn(definition());
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'A')]);
  assert.deepEqual(result.jobs.map(job => job.elementId).sort(), ['B', 'C']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'B')]);
  assert.equal(result.error, null);
  assert.deepEqual(result.jobs.map(job => job.elementId).sort(), ['C', 'Next']);
  const nextId = result.jobs.find(job => job.elementId === 'Next').executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.jobs.find(job => job.elementId === 'Next').executionId, nextId);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'Next')]);
  assert.equal(result.status, 'waiting');
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'C')]);
  assert.equal(result.error, null);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.jobs, []);
});

test('有限求和拒绝非数值、溢出和未声明运算', () => {
  assert.equal(evaluateBpmnExpression({ op: 'sum', values: [{ value: 1 }, { value: 2 }] }, {}), 3);
  assert.throws(() => evaluateBpmnExpression({ op: 'sum', values: [{ value: '1' }] }, {}), /有限数值/);
  assert.throws(() => evaluateBpmnExpression({ op: 'sum', values: [{ value: Number.MAX_VALUE }, { value: Number.MAX_VALUE }] }, {}), /范围/);
});

test('激活阶段无出口失败，重置阶段无出口允许结束', async () => {
  const source = definition(1);
  source.model.rootElements[0].flowElements.find(item => item.id === 'Join_Next').conditionExpression = formal({ value: false });
  const model = await parseWorkflowBpmn(source);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'A')]);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /no conditional flow taken/);
});

test('未选择的分支不阻塞重置，默认出口忽略自身条件', async () => {
  const source = definition(1), elements = source.model.rootElements[0].flowElements;
  elements.find(item => item.id === 'Fork').$type = 'bpmn:InclusiveGateway';
  for (const id of ['Fork_B', 'Fork_C']) elements.find(item => item.id === id).conditionExpression = formal({ value: false });
  elements.find(item => item.id === 'Join').default = { $ref: 'Join_Next' };
  elements.find(item => item.id === 'Join_Next').conditionExpression = formal({ value: false });
  const model = await parseWorkflowBpmn(source);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['A']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'A')]);
  assert.equal(result.error, null);
  // 13.5 表的两个阶段均可走默认流，因此后续活动有两个顺序令牌。
  for (let count = 0; count < 2; count += 1) result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'Next')]);
  assert.equal(result.status, 'succeeded');
});

test('同入口晚到令牌留给下一轮，不能作为本轮未到分支消费', async () => {
  const source = definition(1), elements = source.model.rootElements[0].flowElements;
  elements.push(flow('A', 'A', { path: 'content.output.value.again' }));
  const model = await parseWorkflowBpmn(source);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ ...complete(result, 'A'), output: { again: true } }]);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ ...complete(result, 'A'), output: { again: false } }, complete(result, 'Next')]);
  assert.equal(result.jobs.some(job => job.elementId === 'Next'), false);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'B')]);
  assert.equal(result.jobs.some(job => job.elementId === 'Next'), false);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'C')]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['Next']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'Next')]);
  assert.equal(result.status, 'succeeded');
});

test('终止事件撤销尚未重置的网关和其他活动', async () => {
  const source = definition(1), elements = source.model.rootElements[0].flowElements;
  elements.find(item => item.id === 'End').eventDefinitions = [{ $type: 'bpmn:TerminateEventDefinition' }];
  const model = await parseWorkflowBpmn(source);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'A')]);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'Next')]);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.jobs, []);
});

test('复杂网关发布检查与显式 XML 往返保留标准激活表达式', async () => {
  const source = definition(), model = await parseWorkflowBpmn(source);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  assert.deepEqual((await importWorkflowBpmnXml(await exportWorkflowBpmnXml(source))).model, model.definition.model);
  for (const condition of [undefined, formal({ value: 2 }), formal({ op: 'eval', value: 'true' }), formal({ path: 'content.activationCount.Missing' }), { ...formal({ value: true }), language: 'javascript' }]) {
    const invalid = definition();
    invalid.model.rootElements[0].flowElements.find(item => item.id === 'Join').activationCondition = condition;
    if (!condition) delete invalid.model.rootElements[0].flowElements.find(item => item.id === 'Join').activationCondition;
    assert.ok(validateWorkflowBpmn(await parseWorkflowBpmn(invalid)).some(issue => issue.code === 'complex-condition'));
  }
});

test('同时调用同一子流程的复杂网关计数与重置状态相互隔离', async () => {
  const source = definition();
  source.model.rootElements[0].isExecutable = false;
  source.model.rootElements.push({ $type: 'bpmn:Process', id: 'Parent', isExecutable: true, flowElements: [
    { $type: 'bpmn:StartEvent', id: 'ParentStart' },
    ...['One', 'Two'].map(id => ({ $type: 'bpmn:CallActivity', id, calledElement: 'Process' })),
    { $type: 'bpmn:EndEvent', id: 'ParentEnd' }, flow('ParentStart', 'One'), flow('ParentStart', 'Two'), flow('One', 'ParentEnd'), flow('Two', 'ParentEnd'),
  ] });
  const model = await parseWorkflowBpmn(source);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.equal(result.jobs.length, 6);
  const first = result.jobs.find(job => job.elementId === 'A').parentExecutionIds[0];
  const selected = result.jobs.filter(job => job.parentExecutionIds[0] === first && ['A', 'B'].includes(job.elementId));
  result = await advanceWorkflowBpmn(model, restore(result), {}, selected.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.error, null);
  assert.equal(result.jobs.filter(job => job.elementId === 'Next').length, 1);
  assert.equal(result.jobs.filter(job => ['A', 'B'].includes(job.elementId)).length, 2);
  result = await advanceWorkflowBpmn(model, restore(result), {}, result.jobs.filter(job => ['A', 'B', 'C', 'Next'].includes(job.elementId)).map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.error, null);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['Next']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [complete(result, 'Next')]);
  assert.equal(result.status, 'succeeded');
});

module.exports = { definition, formal, flow, human };
