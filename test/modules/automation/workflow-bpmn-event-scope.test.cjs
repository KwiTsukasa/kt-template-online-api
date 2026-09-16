const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, validateWorkflowBpmn } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const flow = (source, target) => ({ $type: 'bpmn:SequenceFlow', id: `${source}_${target}`, sourceRef: { $ref: source }, targetRef: { $ref: target } });
const human = id => ({ $type: 'bpmn:UserTask', id, extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: '{"kind":"human","formRef":null,"writableFields":[],"input":{}}' }] } });
const service = id => ({ $type: 'bpmn:ServiceTask', id, implementation: 'https://kwitsukasa.top/schema/workflow/bpmn/1/step', extensionElements: { $type: 'bpmn:ExtensionElements', values: [{ $type: 'kt:Step', body: '{"kind":"script","scripts":[],"input":{}}' }] } });
const event = (id, type, definition, attributes = {}) => ({ $type: `bpmn:${type}`, id, ...attributes, ...definition && { eventDefinitions: [definition] } });
const signal = () => ({ $type: 'bpmn:SignalEventDefinition', signalRef: { $ref: 'Signal' } });
const escalation = () => ({ $type: 'bpmn:EscalationEventDefinition', escalationRef: { $ref: 'Escalation' } });
const restore = result => JSON.parse(JSON.stringify(result.checkpoint));
const ids = result => result.jobs.map(job => job.elementId).sort();
const complete = (model, result, id) => advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: result.jobs.find(job => job.elementId === id).executionId, output: {} }]);
const definition = body => ({ format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'urn:kt:event-scope', rootElements: [
  { $type: 'bpmn:Signal', id: 'Signal' }, { $type: 'bpmn:Escalation', id: 'Escalation', escalationCode: 'REVIEW' },
  { $type: 'bpmn:Process', id: 'Process', isExecutable: true, flowElements: body },
] } });
const modelFor = async body => {
  const model = await parseWorkflowBpmn(definition(body));
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const handler = interrupting => ({ $type: 'bpmn:SubProcess', id: 'Handler', triggeredByEvent: true, flowElements: [
  event('HandleStart', 'StartEvent', signal(), { isInterrupting: interrupting }), human('Review'), event('HandleEnd', 'EndEvent'),
  flow('HandleStart', 'Review'), flow('Review', 'HandleEnd'),
] });
const broadcastBody = () => [
  event('Start', 'StartEvent'), { $type: 'bpmn:ParallelGateway', id: 'Fork' }, human('Main'), human('Trigger1'), human('Trigger2'),
  event('Broadcast1', 'IntermediateThrowEvent', signal()), event('Broadcast2', 'IntermediateThrowEvent', signal()), event('End', 'EndEvent'),
  flow('Start', 'Fork'), flow('Fork', 'Main'), flow('Fork', 'Trigger1'), flow('Main', 'End'), flow('Trigger1', 'Broadcast1'),
  flow('Broadcast1', 'Trigger2'), flow('Trigger2', 'Broadcast2'), flow('Broadcast2', 'End'),
];

test('事件子流程拒绝外部顺序流、附着边界、缺失或重复开始事件以及非中断错误捕获', async () => {
  const invalid = [
    ['event-subprocess-flow', body => body.push(flow('Main', 'Handler'))],
    ['event-subprocess-boundary', body => body.push(event('InvalidBoundary', 'BoundaryEvent', signal(), { attachedToRef: { $ref: 'Handler' } }))],
    ['event-subprocess-start', body => body.at(-1).flowElements.push(event('AnotherStart', 'StartEvent', signal()))],
    ['event-subprocess-trigger', body => delete body.at(-1).flowElements[0].eventDefinitions],
    ['event-subprocess-error', body => body.at(-1).flowElements[0].eventDefinitions = [{ $type: 'bpmn:ErrorEventDefinition' }]],
  ];
  for (const [code, change] of invalid) {
    const body = [...broadcastBody(), handler(false)];
    change(body);
    const model = await parseWorkflowBpmn(definition(body));
    assert.ok(validateWorkflowBpmn(model).some(issue => issue.code === code), code);
  }
});

test('非中断事件子流程允许重叠处理，JSON 恢复保留所有实例且父流程等待处理完毕', async () => {
  const model = await modelFor([...broadcastBody(), handler(false)]);
  let result = await advanceWorkflowBpmn(model, null, { input: { task: 'same-business' } });
  assert.deepEqual(ids(result), ['Main', 'Trigger1']);
  const main = result.jobs.find(job => job.elementId === 'Main').executionId;
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Trigger2']);
  const first = result.jobs.find(job => job.elementId === 'Review').executionId;
  result = await complete(model, result, 'Trigger2');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Review']);
  const reviews = result.jobs.filter(job => job.elementId === 'Review').map(job => job.executionId);
  assert.equal(new Set(reviews).size, 2);
  assert.ok(reviews.includes(first));
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(result.jobs.filter(job => job.elementId === 'Review').map(job => job.executionId).sort(), reviews.sort());
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: main, output: {} }]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(ids(result), ['Review', 'Review']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, reviews.map(executionId => ({ executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

test('中断事件子流程撤销同作用域原待办，处理结束才完成父流程', async () => {
  const model = await modelFor([...broadcastBody(), handler(true)]);
  let result = await advanceWorkflowBpmn(model, null, {});
  const main = result.jobs.find(job => job.elementId === 'Main').executionId;
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Review']);
  assert.ok(result.cancelledExecutionIds.includes(main));
  result = await complete(model, result, 'Review');
  assert.equal(result.status, 'succeeded');
});

test('非中断信号边界重复触发但不撤销宿主，宿主结束后仍等待已生成的分支', async () => {
  const model = await modelFor([...broadcastBody(), event('Boundary', 'BoundaryEvent', signal(), { attachedToRef: { $ref: 'Main' }, cancelActivity: false }), human('Review'), flow('Boundary', 'Review'), flow('Review', 'End')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Trigger2']);
  result = await complete(model, result, 'Trigger2');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Review']);
  assert.equal(result.cancelledExecutionIds.length, 0);
  result = await complete(model, result, 'Main');
  assert.equal(result.status, 'waiting');
  result = await advanceWorkflowBpmn(model, restore(result), {}, result.jobs.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

for (const interrupting of [true, false]) test(`升级边界捕获${interrupting ? '中断' : '保留'}子流程，恢复不重新抛出升级`, async () => {
  const sub = { $type: 'bpmn:SubProcess', id: 'Sub', flowElements: [event('SubStart', 'StartEvent'), human('Trigger'), event('Raise', 'IntermediateThrowEvent', escalation()), human('Inner'), event('SubEnd', 'EndEvent'), flow('SubStart', 'Trigger'), flow('Trigger', 'Raise'), flow('Raise', 'Inner'), flow('Inner', 'SubEnd')] };
  const model = await modelFor([event('Start', 'StartEvent'), sub, event('Boundary', 'BoundaryEvent', escalation(), { attachedToRef: { $ref: 'Sub' }, cancelActivity: interrupting }), human('Review'), event('End', 'EndEvent'), flow('Start', 'Sub'), flow('Sub', 'End'), flow('Boundary', 'Review'), flow('Review', 'End')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger');
  assert.deepEqual(ids(result), interrupting ? ['Review'] : ['Inner', 'Review']);
  const expected = result.jobs.map(job => job.executionId).sort();
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(result.jobs.map(job => job.executionId).sort(), expected);
  result = await advanceWorkflowBpmn(model, restore(result), {}, result.jobs.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

test('未被处理的升级继续原流程，不将升级当成错误或跨流程终止', async () => {
  const model = await modelFor([event('Start', 'StartEvent'), human('Trigger'), event('Raise', 'IntermediateThrowEvent', escalation()), human('Next'), event('End', 'EndEvent'), flow('Start', 'Trigger'), flow('Trigger', 'Raise'), flow('Raise', 'Next'), flow('Next', 'End')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger');
  assert.deepEqual(ids(result), ['Next']);
  assert.equal(result.error, null);
});

test('同一同步链连续抛出两次信号时，非中断边界不能漏掉后一次', async () => {
  const body = broadcastBody().filter(item => item.id !== 'Trigger2' && item.id !== 'Broadcast1_Trigger2' && item.id !== 'Trigger2_Broadcast2');
  const model = await modelFor([...body, flow('Broadcast1', 'Broadcast2'), event('Boundary', 'BoundaryEvent', signal(), { attachedToRef: { $ref: 'Main' }, cancelActivity: false }), human('Review'), flow('Boundary', 'Review'), flow('Review', 'End')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Review']);
});

test('人工事件处理实例恢复后仍能读取原业务输入', async () => {
  const model = await modelFor([...broadcastBody(), handler(false)]);
  let result = await advanceWorkflowBpmn(model, null, { input: { task: 'fixed-business' } });
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(result.jobs.find(job => job.elementId === 'Review').variables.input, { task: 'fixed-business' });
  result = await advanceWorkflowBpmn(model, restore(result), {});
  for (const job of result.jobs) assert.deepEqual(job.variables.input, { task: 'fixed-business' });
});

test('父作用域正常令牌全部完成后，仅等待已有事件处理，不再创建新的处理实例', async () => {
  const sub = handler(false);
  sub.flowElements = sub.flowElements.filter(item => item.id !== 'Review_HandleEnd');
  sub.flowElements.push(event('Again', 'IntermediateThrowEvent', signal()), flow('Review', 'Again'), flow('Again', 'HandleEnd'));
  const model = await modelFor([...broadcastBody(), sub]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger1');
  result = await complete(model, result, 'Trigger2');
  result = await complete(model, result, 'Main');
  const original = result.jobs.map(job => job.executionId);
  result = await advanceWorkflowBpmn(model, restore(result), {}, original.map(executionId => ({ executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.jobs, []);
});

test('升级前的普通人工任务 JSON 快照保留原执行身份且只推进一次', async () => {
  const { Engine } = require('bpmn-engine');
  const { createHash } = require('node:crypto');
  const model = await modelFor([event('Start', 'StartEvent'), human('Legacy'), event('End', 'EndEvent'), flow('Start', 'Legacy'), flow('Legacy', 'End')]);
  const engine = new Engine({ moddleContext: { rootElement: model.root, elementsById: model.elements, references: model.references, warnings: [] }, variables: { input: { business: 'before-upgrade' } } });
  await engine.execute();
  const original = engine.execution.getPostponed()[0].content.executionId;
  const checkpoint = { modelSha256: createHash('sha256').update(JSON.stringify(model.definition.model)).digest('hex'), engine: await engine.getState(), activityScopes: {}, outputs: {} };
  await engine.stop();
  let result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(checkpoint)), {});
  assert.equal(result.jobs[0].executionId, original);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: original, output: { confirmed: true } }]);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.transitions.filter(item => item.event === 'flow.take' && item.elementId === 'Legacy_End').length, 1);
});

for (const legacyFirst of [true, false]) test(`升级前的事件子流程保留原待办，新旧处理先后完成顺序 ${legacyFirst}`, async () => {
  const { Engine } = require('bpmn-engine');
  const { createHash } = require('node:crypto');
  const model = await modelFor([...broadcastBody(), handler(false)]);
  const engine = new Engine({ moddleContext: { rootElement: model.root, elementsById: model.elements, references: model.references, warnings: [] } });
  await engine.execute();
  engine.execution.signal({ id: 'Trigger1' });
  const original = engine.execution.getPostponed().find(item => item.id === 'Handler').getPostponed().find(item => item.id === 'Review').content.executionId;
  const checkpoint = { modelSha256: createHash('sha256').update(JSON.stringify(model.definition.model)).digest('hex'), engine: await engine.getState(), activityScopes: {}, outputs: {} };
  await engine.stop();
  let result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(checkpoint)), {});
  assert.deepEqual(ids(result), ['Main', 'Review', 'Trigger2']);
  assert.equal(result.jobs.find(job => job.elementId === 'Review').executionId, original);
  result = await complete(model, result, 'Trigger2');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Review']);
  const first = legacyFirst ? original : result.jobs.find(job => job.elementId === 'Review' && job.executionId !== original).executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: first, output: {} }]);
  assert.deepEqual(ids(result), ['Main', 'Review']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, result.jobs.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

test('同一服务节点的重复边界令牌各有执行身份，结果恢复和出口均只消费一次', async () => {
  const model = await modelFor([...broadcastBody(), event('Boundary', 'BoundaryEvent', signal(), { attachedToRef: { $ref: 'Main' }, cancelActivity: false }), service('Work'), flow('Boundary', 'Work'), flow('Work', 'End')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await complete(model, result, 'Trigger1');
  result = await complete(model, result, 'Trigger2');
  const workIds = result.jobs.filter(job => job.elementId === 'Work').map(job => job.executionId);
  assert.equal(new Set(workIds).size, 2);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: workIds[0], output: { receipt: 'one' } }]);
  assert.deepEqual(result.jobs.filter(job => job.elementId === 'Work').map(job => job.executionId), [workIds[1]]);
  assert.equal(result.transitions.filter(item => item.event === 'flow.take' && item.elementId === 'Work_End').length, 1);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: workIds[0], output: { receipt: 'duplicate' } }]);
  assert.deepEqual(result.unconsumedCompletionIds, [workIds[0]]);
  assert.equal(result.transitions.filter(item => item.event === 'flow.take' && item.elementId === 'Work_End').length, 0);
  result = await advanceWorkflowBpmn(model, restore(result), {}, result.jobs.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

test('多实例子流程中的中断事件仅撤销收到该事件的实例，其他实例仍可继续', async () => {
  const sub = { $type: 'bpmn:SubProcess', id: 'Outer', loopCharacteristics: { $type: 'bpmn:MultiInstanceLoopCharacteristics', isSequential: false, loopCardinality: { $type: 'bpmn:FormalExpression', body: '2' } }, flowElements: [...broadcastBody().map(item => item.id === 'Broadcast1' || item.id === 'Broadcast2' ? { ...item, eventDefinitions: [escalation()] } : item), { ...handler(true), flowElements: handler(true).flowElements.map(item => item.id === 'HandleStart' ? { ...item, eventDefinitions: [escalation()] } : item) }] };
  const model = await modelFor([event('OuterStart', 'StartEvent'), sub, event('OuterEnd', 'EndEvent'), flow('OuterStart', 'Outer'), flow('Outer', 'OuterEnd')]);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(ids(result), ['Main', 'Main', 'Trigger1', 'Trigger1']);
  const originalMains = result.jobs.filter(job => job.elementId === 'Main');
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Main', 'Review', 'Trigger1']);
  assert.equal(originalMains.filter(job => result.cancelledExecutionIds.includes(job.executionId)).length, 1);
  result = await complete(model, result, 'Review');
  assert.deepEqual(ids(result), ['Main', 'Trigger1']);
  result = await complete(model, result, 'Trigger1');
  assert.deepEqual(ids(result), ['Review']);
  result = await complete(model, result, 'Review');
  assert.equal(result.status, 'succeeded');
});

test('升级前的服务任务 JSON 快照保持原脚本身份，结果仅交付一次', async () => {
  const { Engine } = require('bpmn-engine');
  const { createHash } = require('node:crypto');
  const model = await modelFor([event('Start', 'StartEvent'), service('Work'), event('End', 'EndEvent'), flow('Start', 'Work'), flow('Work', 'End')]);
  const engine = new Engine({ moddleContext: { rootElement: model.root, elementsById: model.elements, references: model.references, warnings: [] }, extensions: { legacy: activity => { if (activity.type === 'bpmn:ServiceTask') activity.behaviour.Service = class { execute() {} }; } } });
  await engine.execute();
  const original = engine.execution.getPostponed()[0].content.executionId;
  const checkpoint = { modelSha256: createHash('sha256').update(JSON.stringify(model.definition.model)).digest('hex'), engine: await engine.getState(), activityScopes: {}, outputs: {} };
  await engine.stop();
  let result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(checkpoint)), {});
  assert.equal(result.jobs[0].executionId, original);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [{ executionId: original, output: { done: true } }]);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.transitions.filter(item => item.event === 'flow.take' && item.elementId === 'Work_End').length, 1);
});
