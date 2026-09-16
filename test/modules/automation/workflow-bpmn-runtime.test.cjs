const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, serializeWorkflowBpmn, validateWorkflowBpmn, importWorkflowBpmnXml, exportWorkflowBpmnXml } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const { KT_BPMN_NAMESPACE, KT_BPMN_EXPRESSION, KT_BPMN_STEP } = require('../../../src/modules/workflow-engine/contract/workflow-bpmn.types');

/**
 * 将单个流程体包成标准 BPMN 文档，扩展只放在独立命名空间。
 * @param body - 用于断言标准执行语义的流程体。
 * @param roots - 流程外的错误等标准根元素。
 * @returns 当前测试可解析的 BPMN 定义。
 */
async function diagram(body, roots = '') {
  return parseWorkflowBpmn(await importWorkflowBpmnXml(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:kt="${KT_BPMN_NAMESPACE}" id="Definitions_1" targetNamespace="urn:kt:test">${roots}<bpmn:process id="Process_1" isExecutable="true">${body}</bpmn:process></bpmn:definitions>`));
}

/**
 * 创建只会产生活动实例等待记录的服务任务，测试不运行真实媒体脚本。
 * @param id - 标准活动标识。
 * @param children - 循环等标准活动子元素。
 * @returns 含 KT 步骤扩展的标准服务任务 XML。
 */
function step(id, children = '') {
  return `<bpmn:serviceTask id="${id}" implementation="${KT_BPMN_STEP}"><bpmn:extensionElements><kt:step>{"kind":"script","scripts":[],"input":{}}</kt:step></bpmn:extensionElements>${children}</bpmn:serviceTask>`;
}

/**
 * 建立标准顺序流，条件必须使用 FormalExpression 声明。
 * @param source - 流源节点标识。
 * @param target - 流目标节点标识。
 * @param condition - 可选的明确表达式。
 * @returns 带固定标识的 BPMN 顺序流 XML。
 */
function flow(source, target, condition) {
  let body = '';
  if (condition) body = `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="${KT_BPMN_EXPRESSION}"><![CDATA[${JSON.stringify(condition)}]]></bpmn:conditionExpression>`;
  return `<bpmn:sequenceFlow id="f_${source}_${target}" sourceRef="${source}" targetRef="${target}">${body}</bpmn:sequenceFlow>`;
}

test('内部模型保存引用与标准类型，显式 XML 导出导入保留业务扩展', async () => {
  const original = await diagram('<bpmn:startEvent id="s"/>' + step('a') + '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e'));
  assert.deepEqual(validateWorkflowBpmn(original), []);
  const serialized = await serializeWorkflowBpmn(original.root);
  assert.equal(Object.hasOwn(serialized, 'xml'), false);
  assert.equal(serialized.model.$type, 'bpmn:Definitions');
  const restored = await parseWorkflowBpmn(serialized);
  assert.equal(restored.elements.a.$type, 'bpmn:ServiceTask');
  assert.equal(restored.elements.a.extensionElements.values[0].$type, 'kt:Step');
  assert.equal(restored.elements.f_a_e.targetRef, restored.elements.e);
  const exported = await exportWorkflowBpmnXml(serialized);
  assert.match(exported, /<bpmn:definitions/);
  const imported = await importWorkflowBpmnXml(exported);
  assert.deepEqual(imported.model, serialized.model);
});

test('事务取消先执行已完成活动的补偿，持久恢复后再进入取消路径', async () => {
  const undo = step('undo').replace('implementation=', 'isForCompensation="true" implementation=');
  const transaction = '<bpmn:transaction id="t"><bpmn:startEvent id="ts"/>' + step('a') + undo + '<bpmn:boundaryEvent id="comp" attachedToRef="a"><bpmn:compensateEventDefinition/></bpmn:boundaryEvent><bpmn:association id="comp_link" sourceRef="comp" targetRef="undo" associationDirection="One"/><bpmn:endEvent id="cancel"><bpmn:cancelEventDefinition/></bpmn:endEvent>' + flow('ts', 'a') + flow('a', 'cancel') + '</bpmn:transaction>';
  const model = await diagram('<bpmn:startEvent id="s"/>' + transaction + '<bpmn:boundaryEvent id="cancelled" attachedToRef="t"><bpmn:cancelEventDefinition/></bpmn:boundaryEvent>' + step('recovered') + '<bpmn:endEvent id="e"/>' + flow('s', 't') + flow('t', 'e') + flow('cancelled', 'recovered') + flow('recovered', 'e'));
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['a']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: { receipt: 'original-side-effect' } }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['undo']);
  const compensationId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {});
  assert.equal(result.jobs[0].executionId, compensationId);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: compensationId, output: { restored: true } }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['recovered']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('泳道与消息端点验证拒绝错误作用域和非消息事件，事务可连接顺序流', async () => {
  const model = await diagram('<bpmn:laneSet id="ls"><bpmn:lane id="l"><bpmn:flowNodeRef>a</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:startEvent id="s"/>' + step('a') + '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e'), '<bpmn:collaboration id="c"><bpmn:participant id="p" processRef="Process_1"/><bpmn:participant id="external"/><bpmn:messageFlow id="message" sourceRef="a" targetRef="external"/></bpmn:collaboration>');
  assert.deepEqual(validateWorkflowBpmn(model), []);
  model.elements.message.sourceRef = model.elements.s;
  assert.ok(validateWorkflowBpmn(model).some(issue => issue.code === 'message-kind'));
  model.elements.l.flowNodeRef = [model.elements.f_s_a];
  assert.ok(validateWorkflowBpmn(model).some(issue => issue.code === 'lane-reference'));
});

test('编辑保存与执行直接消费结构化模型，不调用 XML 解析或生成', async () => {
  const BpmnModdle = require('bpmn-moddle');
  const { normalizeWorkflowDocument } = require('../../../src/modules/workflow-engine/domain/workflow-document.policy');
  const definition = { format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'd', targetNamespace: 'urn:kt:test', rootElements: [{ $type: 'bpmn:Process', id: 'p', isExecutable: true, flowElements: [{ $type: 'bpmn:StartEvent', id: 's' }, { $type: 'bpmn:EndEvent', id: 'e' }, { $type: 'bpmn:SequenceFlow', id: 'f', sourceRef: { $ref: 's' }, targetRef: { $ref: 'e' } }] }] } };
  const fromXML = BpmnModdle.prototype.fromXML, toXML = BpmnModdle.prototype.toXML;
  BpmnModdle.prototype.fromXML = BpmnModdle.prototype.toXML = () => { throw new Error('普通操作不允许使用 XML'); };
  try {
    const saved = await normalizeWorkflowDocument(definition);
    const model = await parseWorkflowBpmn(JSON.parse(JSON.stringify(saved)));
    const result = await advanceWorkflowBpmn(model, null, {});
    assert.equal(result.status, 'succeeded');
    assert.equal(Object.hasOwn(result.checkpoint, 'xmlSha256'), false);
    await assert.rejects(parseWorkflowBpmn({ ...definition, xml: '<definitions/>' }), /结构化/);
  } finally {
    BpmnModdle.prototype.fromXML = fromXML;
    BpmnModdle.prototype.toXML = toXML;
  }
});

test('JSON 标准属性保留布尔和数值类型，不能用字符串绕过元模型约束', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>' + flow('s', 'e'));
  const definition = structuredClone(model.definition);
  definition.model.rootElements[0].isExecutable = 'false';
  await assert.rejects(parseWorkflowBpmn(definition), /布尔/);
  const { evaluateBpmnExpression } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-expression');
  assert.throws(() => evaluateBpmnExpression({ value: {} }, {}), /常量/);
  assert.throws(() => evaluateBpmnExpression({ op: 'and', values: [] }, {}), /子条件/);
  assert.throws(() => evaluateBpmnExpression({ path: 'input.constructor' }, { input: {} }), /原型/);
});

test('并行汇合在完整快照恢复后仍等待每条活动分支', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:parallelGateway id="fork"/><bpmn:parallelGateway id="join"/>' + step('a') + step('b') + step('c') + '<bpmn:endEvent id="e"/>' + flow('s', 'fork') + flow('fork', 'a') + flow('fork', 'b') + flow('a', 'join') + flow('b', 'join') + flow('join', 'c') + flow('c', 'e'));
  let result = await advanceWorkflowBpmn(model, null, { input: {} });
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.jobs.map((job) => job.elementId).sort(), ['a', 'b']);
  const a = result.jobs.find((job) => job.elementId === 'a');
  const b = result.jobs.find((job) => job.elementId === 'b');
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: a.executionId, output: { amount: 1 } }]);
  assert.deepEqual(result.jobs.map((job) => job.elementId), ['b']);
  assert.equal(result.jobs[0].executionId, b.executionId);
  assert.ok(result.jobs[0].parentExecutionIds.length > 0);
  assert.ok(result.transitions.length > 0);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: b.executionId, output: { amount: 2 } }]);
  assert.deepEqual(result.jobs.map((job) => job.elementId), ['c']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('排他网关只选择命中的条件或默认顺序流', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:exclusiveGateway id="g" default="f_g_b"/>' + step('a') + step('b') + '<bpmn:endEvent id="e"/>' + flow('s', 'g') + flow('g', 'a', { path: 'input.approved' }) + flow('g', 'b') + flow('a', 'e') + flow('b', 'e'));
  const accepted = await advanceWorkflowBpmn(model, null, { input: { approved: true } });
  const rejected = await advanceWorkflowBpmn(model, null, { input: { approved: false } });
  assert.deepEqual(accepted.jobs.map((job) => job.elementId), ['a']);
  assert.deepEqual(rejected.jobs.map((job) => job.elementId), ['b']);
});

test('并行多实例使用独立身份，部分结果不能让整个活动提前完成', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/>' + step('a', '<bpmn:multiInstanceLoopCharacteristics isSequential="false"><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>') + '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.equal(result.jobs.length, 3);
  assert.equal(new Set(result.jobs.map((job) => job.executionId)).size, 3);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'waiting');
  assert.equal(result.jobs.length, 2);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, result.jobs.map((job) => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded', JSON.stringify({ jobs: result.jobs, unused: result.unconsumedCompletionIds, events: result.transitions, error: result.error }));
});

test('错误边界事件捕获匹配错误代码并进入恢复分支', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/>' + step('a') + step('recover') + '<bpmn:boundaryEvent id="catch" attachedToRef="a"><bpmn:errorEventDefinition id="catch_def" errorRef="error_42"/></bpmn:boundaryEvent><bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e') + flow('catch', 'recover') + flow('recover', 'e'), '<bpmn:error id="error_42" errorCode="42"/>');
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, error: { code: '42', message: '步骤业务失败' } }]);
  assert.equal(result.error, null);
  assert.deepEqual(result.jobs.map((job) => job.elementId), ['recover']);
});

test('未被边界事件捕获的业务错误结束流程，不停留在等待状态', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/>' + step('a') + '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, error: { code: 'FAILED', message: '真实脚本退出失败' } }]);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /真实脚本退出失败/);
});

test('XML 拒绝失效引用、实体声明以及事务外取消事件', async () => {
  await assert.rejects(diagram('<bpmn:sequenceFlow id="f" sourceRef="missing" targetRef="also_missing"/>'), /未解析内容/);
  await assert.rejects(importWorkflowBpmnXml('<!DOCTYPE x><x/>'), /DTD/);
  const invalid = await diagram('<bpmn:endEvent id="e"><bpmn:cancelEventDefinition id="cancel"/></bpmn:endEvent>');
  assert.ok(validateWorkflowBpmn(invalid).some((issue) => issue.code === 'cancel-scope'));
});

test('标准循环前置条件为假时零次执行，后置条件为假时执行一次', async () => {
  const condition = '<bpmn:loopCondition xsi:type="bpmn:tFormalExpression"><![CDATA[{"path":"input.again"}]]></bpmn:loopCondition>';
  const prefix = '<bpmn:startEvent id="s"/>', suffix = '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e');
  const before = await diagram(prefix + step('a', `<bpmn:standardLoopCharacteristics testBefore="true" loopMaximum="5">${condition}</bpmn:standardLoopCharacteristics>`) + suffix);
  let result = await advanceWorkflowBpmn(before, null, { input: { again: false } });
  assert.equal(result.jobs.length, 0);
  assert.equal(result.status, 'succeeded');
  const after = await diagram(prefix + step('a', `<bpmn:standardLoopCharacteristics testBefore="false" loopMaximum="5">${condition}</bpmn:standardLoopCharacteristics>`) + suffix);
  result = await advanceWorkflowBpmn(after, null, { input: { again: false } });
  assert.equal(result.jobs.length, 1);
  result = await advanceWorkflowBpmn(after, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('普通结束只消耗本路径令牌，终止结束撤销并行任务', async () => {
  const prefix = '<bpmn:startEvent id="s"/><bpmn:parallelGateway id="fork"/>' + step('a') + flow('s', 'fork') + flow('fork', 'a') + flow('fork', 'e');
  const ordinary = await diagram(prefix + '<bpmn:endEvent id="e"/>' + flow('a', 'e'));
  const result = await advanceWorkflowBpmn(ordinary, null, {});
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.jobs.map((job) => job.elementId), ['a']);
  const terminating = await diagram(prefix + '<bpmn:endEvent id="e"><bpmn:terminateEventDefinition id="terminate"/></bpmn:endEvent>' + flow('a', 'e'));
  const end = await advanceWorkflowBpmn(terminating, null, {});
  assert.equal(end.status, 'succeeded');
  assert.equal(end.jobs.length, 0, JSON.stringify({ jobs: end.jobs, transitions: end.transitions }));
});

test('定时事件保存绝对到期时间，恢复不重新计时', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="timer"><bpmn:timerEventDefinition id="timer_def"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT0.05S</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent><bpmn:endEvent id="e"/>' + flow('s', 'timer') + flow('timer', 'e'));
  const first = await advanceWorkflowBpmn(model, null, {});
  assert.equal(first.status, 'waiting');
  assert.deepEqual(first.activeActivities.map(item=>item.nodeId), ['timer']);
  assert.ok(first.nextWakeAt >= Date.now() - 100);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const resumed = await advanceWorkflowBpmn(model, first.checkpoint, {});
  assert.equal(resumed.status, 'succeeded');
  assert.deepEqual(resumed.activeActivities, []);
});

test('子流程终止只撤销本作用域，恢复后的外层并行任务仍可完成', async () => {
  const inner = '<bpmn:subProcess id="sub"><bpmn:startEvent id="ss"/><bpmn:parallelGateway id="sf"/>' + step('inside') + step('trigger') + '<bpmn:endEvent id="se"><bpmn:terminateEventDefinition id="st"/></bpmn:endEvent>' + flow('ss', 'sf') + flow('sf', 'inside') + flow('sf', 'trigger') + flow('trigger', 'se') + flow('inside', 'se') + '</bpmn:subProcess>';
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:parallelGateway id="fork"/>' + inner + step('outside') + '<bpmn:endEvent id="e"/>' + flow('s', 'fork') + flow('fork', 'sub') + flow('fork', 'outside') + flow('sub', 'e') + flow('outside', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.equal(result.jobs.length, 3);
  const inside = result.jobs.find((job) => job.elementId === 'inside');
  const trigger = result.jobs.find((job) => job.elementId === 'trigger');
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: trigger.executionId, output: {} }]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.jobs.map((job) => job.elementId), ['outside']);
  assert.deepEqual(result.cancelledExecutionIds, [inside.executionId]);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('标准循环持续条件为真时遵守最大次数并在恢复后退出', async () => {
  const loop = '<bpmn:standardLoopCharacteristics testBefore="true" loopMaximum="3"><bpmn:loopCondition xsi:type="bpmn:tFormalExpression"><![CDATA[{"path":"input.again"}]]></bpmn:loopCondition></bpmn:standardLoopCharacteristics>';
  const model = await diagram('<bpmn:startEvent id="s"/>' + step('a', loop) + '<bpmn:endEvent id="e"/>' + flow('s', 'a') + flow('a', 'e'));
  let result = await advanceWorkflowBpmn(model, null, { input: { again: true } });
  const identities = new Set();
  for (let index = 0; index < 3; index++) {
    assert.equal(result.jobs.length, 1);
    identities.add(result.jobs[0].executionId);
    result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: { index } }]);
  }
  assert.equal(identities.size, 3);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.jobs.length, 0);
});

/**
 * 创建带明确确认契约的标准用户任务，测试仅交付持久化后的人工结果。
 * @param id - 用户任务元素标识。
 * @param children - 可选多实例或循环定义。
 * @returns 用于执行内核验证的用户任务 XML。
 */
function human(id, children = '') {
  return `<bpmn:userTask id="${id}"><bpmn:extensionElements><kt:step>{"kind":"human","formRef":null,"writableFields":[],"input":{}}</kt:step></bpmn:extensionElements>${children}</bpmn:userTask>`;
}

test('人工节点重建快照后仍等待同一待办，提交结果后自动进入原链路', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/>'+human('review')+step('next')+'<bpmn:endEvent id="e"/>'+flow('s','review')+flow('review','next')+flow('next','e'));
  let result=await advanceWorkflowBpmn(model,null,{input:{taskId:'one'}});
  assert.equal(result.jobs[0].step.kind,'human');
  assert.deepEqual(result.activeActivities.map(item=>item.nodeId), ['review']);
  const executionId=result.jobs[0].executionId;
  result=await advanceWorkflowBpmn(model,JSON.parse(JSON.stringify(result.checkpoint)),{input:{taskId:'one'}});
  assert.equal(result.jobs[0].executionId,executionId);
  result=await advanceWorkflowBpmn(model,result.checkpoint,{input:{taskId:'one'}},[{executionId,output:{confirmed:true}}]);
  assert.deepEqual(result.unconsumedCompletionIds,[]);
  assert.deepEqual(result.checkpoint.outputs.review,{confirmed:true});
  assert.equal(result.jobs[0].elementId,'next');
  assert.deepEqual(result.activeActivities.map(item=>item.nodeId), ['next']);
});

test('同一用户任务的多个活动实例不能被一次人工提交同时完成', async () => {
  const model=await diagram('<bpmn:startEvent id="s"/>'+human('review','<bpmn:multiInstanceLoopCharacteristics isSequential="false"><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>')+'<bpmn:endEvent id="e"/>'+flow('s','review')+flow('review','e'));
  let result=await advanceWorkflowBpmn(model,null,{});
  assert.equal(result.jobs.length,3);
  result=await advanceWorkflowBpmn(model,result.checkpoint,{},[{executionId:result.jobs[0].executionId,output:{confirmed:true}}]);
  assert.equal(result.status,'waiting');assert.equal(result.jobs.length,2);
  result=await advanceWorkflowBpmn(model,result.checkpoint,{},result.jobs.map(job=>({executionId:job.executionId,output:{confirmed:true}})));
  assert.equal(result.status,'succeeded');assert.equal(result.unconsumedCompletionIds.length,0);
});

test('包容网关恢复后只等待本次激活的分支，未选分支不阻塞汇合', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:inclusiveGateway id="split"/>' + step('a') + step('b') + step('c') + '<bpmn:inclusiveGateway id="join"/>' + step('after') + '<bpmn:endEvent id="e"/>' + flow('s', 'split') + flow('split', 'a', { path: 'input.a' }) + flow('split', 'b', { path: 'input.b' }) + flow('split', 'c', { path: 'input.c' }) + flow('a', 'join') + flow('b', 'join') + flow('c', 'join') + flow('join', 'after') + flow('after', 'e'));
  let result = await advanceWorkflowBpmn(model, null, { input: { a: true, b: true, c: false } });
  assert.deepEqual(result.jobs.map(job => job.elementId).sort(), ['a', 'b']);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs.find(job => job.elementId === 'a').executionId, output: {} }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['b']);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('事件网关恢复后首个消息继续对应分支并撤销另一条等待', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:eventBasedGateway id="race"/><bpmn:intermediateCatchEvent id="catch_a"><bpmn:messageEventDefinition messageRef="Message_a"/></bpmn:intermediateCatchEvent><bpmn:intermediateCatchEvent id="catch_b"><bpmn:messageEventDefinition messageRef="Message_b"/></bpmn:intermediateCatchEvent>' + step('a') + step('b') + '<bpmn:endEvent id="e"/>' + flow('s', 'race') + flow('race', 'catch_a') + flow('race', 'catch_b') + flow('catch_a', 'a') + flow('catch_b', 'b') + flow('a', 'e') + flow('b', 'e'), '<bpmn:message id="Message_a"/><bpmn:message id="Message_b"/>');
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.activeActivities.filter(item => item.nodeId.startsWith('catch_')).map(item => item.nodeId).sort(), ['catch_a', 'catch_b']);
  const waiting = result.activeActivities.find(item => item.nodeId === 'catch_b');
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: 'catch_b', executionId: waiting.executionId }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['b']);
  assert.equal(result.activeActivities.some(item => item.nodeId === 'catch_a'), false);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('调用活动恢复被调用流程后回到父流程且不会重复执行子活动', async () => {
  const child = '<bpmn:process id="Child"><bpmn:startEvent id="cs"/>' + step('inside_call') + '<bpmn:endEvent id="ce"/>' + flow('cs', 'inside_call') + flow('inside_call', 'ce') + '</bpmn:process>';
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:callActivity id="call" calledElement="Child"/>' + step('after_call') + '<bpmn:endEvent id="e"/>' + flow('s', 'call') + flow('call', 'after_call') + flow('after_call', 'e'), child);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['inside_call']);
  const executionId = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {});
  assert.equal(result.jobs[0].executionId, executionId);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId, output: { value: 42 } }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after_call']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('信号广播在恢复后唤醒所有订阅分支并只执行一次后续活动', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:parallelGateway id="split"/><bpmn:intermediateCatchEvent id="catch_a"><bpmn:signalEventDefinition signalRef="Signal_ready"/></bpmn:intermediateCatchEvent><bpmn:intermediateCatchEvent id="catch_b"><bpmn:signalEventDefinition signalRef="Signal_ready"/></bpmn:intermediateCatchEvent>' + step('trigger') + '<bpmn:intermediateThrowEvent id="broadcast"><bpmn:signalEventDefinition signalRef="Signal_ready"/></bpmn:intermediateThrowEvent>' + step('a') + step('b') + '<bpmn:endEvent id="e"/>' + flow('s', 'split') + flow('split', 'catch_a') + flow('split', 'catch_b') + flow('split', 'trigger') + flow('trigger', 'broadcast') + flow('broadcast', 'e') + flow('catch_a', 'a') + flow('catch_b', 'b') + flow('a', 'e') + flow('b', 'e'), '<bpmn:signal id="Signal_ready"/>');
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['trigger']);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.deepEqual(result.jobs.map(job => job.elementId).sort(), ['a', 'b']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, result.jobs.map(job => ({ executionId: job.executionId, output: {} })));
  assert.equal(result.status, 'succeeded');
});

test('条件事件按声明的表达式等待，恢复后条件满足才继续', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="condition"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression" language="' + KT_BPMN_EXPRESSION + '"><![CDATA[{"path":"content.message.ready"}]]></bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>' + step('after_condition') + '<bpmn:endEvent id="e"/>' + flow('s', 'condition') + flow('condition', 'after_condition') + flow('after_condition', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.activeActivities.map(item => item.nodeId), ['condition']);
  const waiting = result.activeActivities[0];
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: 'condition', executionId: waiting.executionId, ready: false }]);
  assert.equal(result.jobs.length, 0);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: 'condition', executionId: waiting.executionId, ready: true }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after_condition']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('同层链接事件跳转到对应捕获事件并在后续活动恢复', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateThrowEvent id="jump"><bpmn:linkEventDefinition name="continue"/></bpmn:intermediateThrowEvent><bpmn:intermediateCatchEvent id="landing"><bpmn:linkEventDefinition name="continue"/></bpmn:intermediateCatchEvent>' + step('after_link') + '<bpmn:endEvent id="e"/>' + flow('s', 'jump') + flow('landing', 'after_link') + flow('after_link', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after_link']);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('业务结果变更自动重新计算等待中的条件事件，不要求人工发送信号', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:parallelGateway id="split"/><bpmn:intermediateCatchEvent id="condition"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression" language="' + KT_BPMN_EXPRESSION + '"><![CDATA[{"path":"outputs.change.ready"}]]></bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>' + step('change') + step('after_condition') + '<bpmn:endEvent id="e"/>' + flow('s', 'split') + flow('split', 'condition') + flow('split', 'change') + flow('condition', 'after_condition') + flow('change', 'e') + flow('after_condition', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.jobs.map(job => job.elementId), ['change']);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: { ready: true } }]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after_condition']);
  result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('包容汇合仅一个分支激活时正常通过，混合网关继续按条件分流', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:inclusiveGateway id="split"/>' + step('a') + step('b') + '<bpmn:inclusiveGateway id="mixed" default="f_mixed_fallback"/>' + step('chosen') + step('fallback') + '<bpmn:endEvent id="e"/>' + flow('s', 'split') + flow('split', 'a', { path: 'input.a' }) + flow('split', 'b', { path: 'input.b' }) + flow('a', 'mixed') + flow('b', 'mixed') + flow('mixed', 'chosen', { path: 'input.choose' }) + flow('mixed', 'fallback') + flow('chosen', 'e') + flow('fallback', 'e'));
  for (const choose of [true, false]) {
    let result = await advanceWorkflowBpmn(model, null, { input: { a: true, b: false, choose } });
    assert.deepEqual(result.jobs.map(job => job.elementId), ['a']);
    result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
    let expected = 'fallback';
    if (choose) expected = 'chosen';
    assert.deepEqual(result.jobs.map(job => job.elementId), [expected]);
    result = await advanceWorkflowBpmn(model, result.checkpoint, {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
    assert.equal(result.status, 'succeeded');
  }
});

test('过期的消息实例信号不能唤醒同名活动', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="wait"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent><bpmn:endEvent id="e"/>' + flow('s', 'wait') + flow('wait', 'e'));
  const result = await advanceWorkflowBpmn(model, null, {});
  const restored = await advanceWorkflowBpmn(model, result.checkpoint, {}, [], [{ id: 'wait', executionId: 'another-instance' }]);
  assert.equal(restored.status, 'waiting');
  assert.deepEqual(restored.unconsumedSignalIds, ['another-instance']);
  assert.equal(restored.activeActivities[0].executionId, result.activeActivities[0].executionId);
});

test('事件网关发布检查拒绝条件连线、非法目标和破坏事件竞争的拓扑', async (t) => {
  const message = '<bpmn:intermediateCatchEvent id="a"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>';
  const receive = '<bpmn:receiveTask id="a"/>';
  const timer = '<bpmn:intermediateCatchEvent id="b"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1S</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>';
  const messageB = '<bpmn:intermediateCatchEvent id="b"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>';
  const cases = [
    ['至少两个出口', message, timer, '', flow('g', 'a'), '', 'event-gateway-outgoing'],
    ['出口不得带条件', message, timer, '', flow('g', 'a', { value: true }) + flow('g', 'b'), '', 'event-gateway-condition'],
    ['不得直接连接业务任务', step('a'), timer, '', flow('g', 'a') + flow('g', 'b'), '', 'event-gateway-target'],
    ['消息捕获与接收任务不得混用', receive, messageB, '', flow('g', 'a') + flow('g', 'b'), '', 'event-gateway-mixed-message'],
    ['接收任务不能带边界事件', receive, timer, '', flow('g', 'a') + flow('g', 'b'), '<bpmn:boundaryEvent id="attached" attachedToRef="a"><bpmn:signalEventDefinition/></bpmn:boundaryEvent>', 'event-gateway-boundary'],
    ['捕获事件不能另接入口', message, timer, '', flow('g', 'a') + flow('g', 'b'), flow('s', 'a'), 'event-gateway-incoming'],
    ['实例化网关不得有入口', message, timer, 'instantiate="true"', flow('g', 'a') + flow('g', 'b'), '', 'event-gateway-instantiate'],
    ['并行事件网关必须实例化', message, timer, 'eventGatewayType="Parallel"', flow('g', 'a') + flow('g', 'b'), '', 'event-gateway-parallel'],
    ['链接事件不能参与竞争', '<bpmn:intermediateCatchEvent id="a"><bpmn:linkEventDefinition name="jump"/></bpmn:intermediateCatchEvent>', timer, '', flow('g', 'a') + flow('g', 'b'), '', 'event-gateway-trigger'],
  ];
  for (const [name, a, b, attributes, outgoing, extra, code] of cases) {
    await t.test(name, async () => {
      const model = await diagram('<bpmn:startEvent id="s"/><bpmn:eventBasedGateway id="g" ' + attributes + '/>' + a + b + '<bpmn:endEvent id="e"/>' + flow('s', 'g') + outgoing + flow('a', 'e') + flow('b', 'e') + extra);
      assert.ok(validateWorkflowBpmn(model).some(issue => issue.code === code), name);
    });
  }
  const valid = await diagram('<bpmn:startEvent id="s"/><bpmn:eventBasedGateway id="g"/>' + receive + timer + '<bpmn:endEvent id="e"/>' + flow('s', 'g') + flow('g', 'a') + flow('g', 'b') + flow('a', 'e') + flow('b', 'e'));
  assert.deepEqual(validateWorkflowBpmn(valid), []);
});

test('已持久化的竞争消息按顺序消费，失败分支回执废弃且正文只进入获胜节点', async () => {
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:eventBasedGateway id="race"/><bpmn:intermediateCatchEvent id="a"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent><bpmn:intermediateCatchEvent id="b"><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>' + step('after_a') + step('after_b') + '<bpmn:endEvent id="e"/>' + flow('s', 'race') + flow('race', 'a') + flow('race', 'b') + flow('a', 'after_a') + flow('b', 'after_b') + flow('after_a', 'e') + flow('after_b', 'e'));
  let result = await advanceWorkflowBpmn(model, null, {});
  const a = result.activeActivities.find(item => item.nodeId === 'a');
  const b = result.activeActivities.find(item => item.nodeId === 'b');
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [
    { id: 'b', executionId: b.executionId, workflowMessage: true, values: { accepted: true } },
    { id: 'a', executionId: a.executionId, workflowMessage: true, values: { accepted: false } },
  ]);
  assert.deepEqual(result.unconsumedSignalIds, [a.executionId]);
  assert.deepEqual(result.jobs.map(job => job.elementId), ['after_b']);
  assert.deepEqual(result.jobs[0].variables.outputs.b, { accepted: true });
  assert.equal(result.checkpoint.outputs.a, undefined);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [{ executionId: result.jobs[0].executionId, output: {} }]);
  assert.equal(result.status, 'succeeded');
});

test('消息端口持久回执在服务重建和流程终态后仍幂等，冲突内容不改写原意图', async () => {
  const { WorkflowMessageService } = require('../../../src/modules/workflow-engine/application/workflow-message.service');
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="wait"><bpmn:messageEventDefinition messageRef="Reply"/></bpmn:intermediateCatchEvent><bpmn:endEvent id="e"/>' + flow('s', 'wait') + flow('wait', 'e'), '<bpmn:message id="Reply"/>');
  const run = { id: '123', workflowId: '45', workflowVersion: 2, status: 'waiting', cancelRequested: false, errorMessage: null, deadlineAt: new Date(Date.now() + 60000), bpmnState: { activeActivities: [{ nodeId: 'wait', executionId: 'wait_1' }], messages: [] } };
  let writes = 0;
  let releases = 0;
  let locked = false;
  const manager = { findOne: async () => structuredClone(run), update: async (_entity, _where, value) => { writes++; Object.assign(run, structuredClone(value)); } };
  const database = { createQueryRunner: () => ({ connect: async () => {}, release: async () => { releases++; }, query: async (sql) => [{ acquired: Number(!locked || !sql.includes('GET_LOCK')) }], manager: { transaction: async (work) => work(manager) } }) };
  const definitions = { resolve: async (reference) => { assert.deepEqual(reference, { id: '45', version: 2 }); return model.definition; } };
  const delivery = { deliveryId: 'reply-1', senderId: 'business-module', nodeId: 'wait', executionId: 'wait_1', messageId: 'Reply', values: { b: 2, a: { ready: true } } };
  const first = await new WorkflowMessageService(database, definitions).receive('123', delivery);
  const restored = new WorkflowMessageService(database, definitions);
  assert.deepEqual(await restored.receive('123', { ...delivery, values: { a: { ready: true }, b: 2 } }), first);
  assert.equal(writes, 1);
  await assert.rejects(() => restored.receive('123', { ...delivery, values: { b: 3 } }), error => error.getStatus() === 409);
  run.status = 'succeeded';
  run.bpmnState.messages[0].status = 'delivered';
  delete run.bpmnState.messages[0].values;
  const repeated = await restored.receive('123', delivery);
  assert.equal(repeated.status, 'delivered');
  assert.equal(Object.hasOwn(repeated, 'values'), false);
  assert.equal(Object.hasOwn(repeated, 'hash'), false);
  await assert.rejects(() => restored.receive('123', { ...delivery, deliveryId: 'reply-2' }), error => error.getStatus() === 409);
  locked = true;
  await assert.rejects(() => restored.receive('123', delivery), error => error.getStatus() === 409);
  assert.equal(writes, 1);
  assert.equal(releases, 6);
});

test('消息端口拒绝非 JSON、过深和超长正文，校验失败不申请流程锁', async () => {
  const { WorkflowMessageService } = require('../../../src/modules/workflow-engine/application/workflow-message.service');
  const service = new WorkflowMessageService({ createQueryRunner: () => { throw new Error('must not acquire lock'); } }, {});
  const delivery = { deliveryId: 'reply-1', senderId: 'business-module', nodeId: 'wait', executionId: 'wait_1', messageId: null, values: {} };
  let deep = {};
  for (let index = 0; index < 18; index++) deep = { nested: deep };
  for (const values of [[], { value: Infinity }, { value: undefined }, { value: new Date() }, JSON.parse('{"__proto__":{"bad":true}}'), deep, { text: 'a'.repeat(65536) }]) {
    await assert.rejects(() => service.receive('123', { ...delivery, values }), error => error.getStatus?.() === 400);
  }
});

test('并行多重消息保留各自事件索引，不能用一种消息完成另一种等待', async () => {
  const { WorkflowMessageService } = require('../../../src/modules/workflow-engine/application/workflow-message.service');
  const model = await diagram('<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="wait" parallelMultiple="true"><bpmn:messageEventDefinition messageRef="A"/><bpmn:messageEventDefinition messageRef="B"/></bpmn:intermediateCatchEvent><bpmn:endEvent id="e"/>' + flow('s', 'wait') + flow('wait', 'e'), '<bpmn:message id="A"/><bpmn:message id="B"/>');
  let result = await advanceWorkflowBpmn(model, null, {});
  assert.deepEqual(result.activeActivities.map(item => item.eventDefinitionIndex).sort(), [0, 1]);
  const second = result.activeActivities.find(item => item.eventDefinitionIndex === 1);
  const run = { id: '123', workflowId: '45', workflowVersion: 1, status: 'waiting', deadlineAt: new Date(Date.now() + 60000), bpmnState: { activeActivities: result.activeActivities, messages: [] } };
  const manager = { findOne: async () => structuredClone(run), update: async (_entity, _where, values) => Object.assign(run, values) };
  const database = { createQueryRunner: () => ({ connect: async () => {}, release: async () => {}, query: async () => [{ acquired: 1 }], manager: { transaction: async (work) => work(manager) } }) };
  const service = new WorkflowMessageService(database, { resolve: async () => model.definition });
  const delivery = { deliveryId: 'reply-b', senderId: 'business', nodeId: 'wait', executionId: second.executionId, messageId: 'B', values: {} };
  await assert.rejects(() => service.receive('123', { ...delivery, messageId: 'A' }), error => error.getStatus() === 400);
  await service.receive('123', delivery);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: 'wait', executionId: second.executionId }]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.activeActivities.map(item => item.eventDefinitionIndex), [0]);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: 'wait', executionId: result.activeActivities[0].executionId }]);
  assert.equal(result.status, 'succeeded');
});
