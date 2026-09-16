const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseWorkflowBpmn, validateWorkflowBpmn, exportWorkflowBpmnXml, importWorkflowBpmnXml } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const { correlateBpmnMessage } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-correlation');
const { advanceWorkflowBpmn } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const { KT_BPMN_EXPRESSION } = require('../../../src/modules/workflow-engine/contract/workflow-bpmn.types');

/**
 * 创建共享复合关联键的两个消息等待，第二种消息使用不同正文路径。
 * @param subscribed - 是否从流程输入动态绑定关联键。
 * @returns 可直接修改并通过真实元模型解析的 JSON 文档。
 */
function definition(subscribed = false) {
  const ref = id => ({ $ref: id });
  const expression = path => ({ $type: 'bpmn:FormalExpression', language: KT_BPMN_EXPRESSION, body: JSON.stringify({ path }) });
  const property = (id, field) => ({ $type: 'bpmn:CorrelationProperty', id, correlationPropertyRetrievalExpression: [
    { $type: 'bpmn:CorrelationPropertyRetrievalExpression', messageRef: ref('First'), messagePath: expression('content.' + field) },
    { $type: 'bpmn:CorrelationPropertyRetrievalExpression', messageRef: ref('Second'), messagePath: expression('content.reply.' + field) },
  ] });
  const flow = (source, target) => ({ $type: 'bpmn:SequenceFlow', id: source + '_' + target, sourceRef: ref(source), targetRef: ref(target) });
  const subscriptions = [];
  if (subscribed) subscriptions.push({ $type: 'bpmn:CorrelationSubscription', correlationKeyRef: ref('OrderKey'), correlationPropertyBinding: [
    { $type: 'bpmn:CorrelationPropertyBinding', correlationPropertyRef: ref('Tenant'), dataPath: expression('input.tenant') },
    { $type: 'bpmn:CorrelationPropertyBinding', correlationPropertyRef: ref('Order'), dataPath: expression('input.order') },
  ] });
  return { format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'Definitions', targetNamespace: 'urn:kt:correlation', rootElements: [
    { $type: 'bpmn:Message', id: 'First' }, { $type: 'bpmn:Message', id: 'Second' }, property('Tenant', 'tenant'), property('Order', 'order'),
    { $type: 'bpmn:Process', id: 'Process', isExecutable: true, correlationSubscriptions: subscriptions, flowElements: [
      { $type: 'bpmn:StartEvent', id: 'Start', eventDefinitions: [{ $type: 'bpmn:MessageEventDefinition', messageRef: ref('First') }] },
      { $type: 'bpmn:IntermediateCatchEvent', id: 'Reply', eventDefinitions: [{ $type: 'bpmn:MessageEventDefinition', messageRef: ref('Second') }] },
      { $type: 'bpmn:EndEvent', id: 'End' }, flow('Start', 'Reply'), flow('Reply', 'End'),
    ] },
    { $type: 'bpmn:Collaboration', id: 'Collaboration', participants: [
      { $type: 'bpmn:Participant', id: 'Business', processRef: ref('Process') }, { $type: 'bpmn:Participant', id: 'Sender' },
    ], correlationKeys: [{ $type: 'bpmn:CorrelationKey', id: 'OrderKey', correlationPropertyRef: [ref('Tenant'), ref('Order')] }], messageFlows: [
      { $type: 'bpmn:MessageFlow', id: 'FirstFlow', messageRef: ref('First'), sourceRef: ref('Sender'), targetRef: ref('Start') },
      { $type: 'bpmn:MessageFlow', id: 'ReplyFlow', messageRef: ref('Second'), sourceRef: ref('Sender'), targetRef: ref('Reply') },
    ] },
  ] } };
}

test('标准关联模型通过 JSON 与显式 XML 往返，匿名表达式同样受校验', async () => {
  const source = definition(true);
  const model = await parseWorkflowBpmn(source);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  const imported = await importWorkflowBpmnXml(await exportWorkflowBpmnXml(source));
  assert.deepEqual(imported.model, model.definition.model);
  source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression[0].messagePath.language = 'javascript';
  assert.ok(validateWorkflowBpmn(await parseWorkflowBpmn(source)).some(issue => issue.code === 'message-correlation' && issue.nodeId === 'Order'));
});

test('复合消息键初始化后按不同消息的路径匹配，租户、类型和缺字段不能串到同一实例', async () => {
  const model = await parseWorkflowBpmn(definition());
  const keys = correlateBpmnMessage(model, 'Start', 'First', { tenant: 'one', order: 0 }, {}, {});
  assert.deepEqual(keys, { OrderKey: { Tenant: 'one', Order: 0 } });
  const restored = JSON.parse(JSON.stringify(keys));
  assert.deepEqual(correlateBpmnMessage(model, 'Reply', 'Second', { reply: { order: 0, tenant: 'one' } }, {}, restored, true), keys);
  for (const reply of [{ tenant: 'two', order: 0 }, { tenant: 'one', order: '0' }, { tenant: 'one' }]) {
    assert.throws(() => correlateBpmnMessage(model, 'Reply', 'Second', { reply }, {}, restored, true), /关联/);
  }
  assert.throws(() => correlateBpmnMessage(model, 'Start', 'First', { tenant: 'one', order: 0 }, {}, {}, true), /关联/);
});

test('流程关联订阅随上下文变更，不能沿用旧值或匹配未初始化的部分键', async () => {
  const model = await parseWorkflowBpmn(definition(true));
  const initial = correlateBpmnMessage(model, 'Start', 'First', { tenant: 'one', order: false }, { input: { tenant: 'one', order: false } }, {}, true);
  assert.throws(() => correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: 'one', order: false } }, { input: { tenant: 'one', order: true } }, initial), /不一致/);
  const current = correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: 'one', order: true } }, { input: { tenant: 'one', order: true } }, initial, true);
  assert.equal(current.OrderKey.Order, true);
  assert.throws(() => correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: 'one', order: true } }, { input: { tenant: 'one' } }, initial), /未初始化/);
});

test('发布拒绝重复提取、缺少消息或表达式、非法路径以及错误的订阅属性', async t => {
  const cases = [
    source => source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression.push(structuredClone(source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression[0])),
    source => delete source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression[0].messageRef,
    source => delete source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression[0].messagePath,
    source => { source.model.rootElements.find(item => item.id === 'Order').correlationPropertyRetrievalExpression[0].messagePath.body = '{"path":"content.__proto__.id"}'; },
    source => source.model.rootElements.find(item => item.id === 'Process').correlationSubscriptions[0].correlationPropertyBinding.pop(),
    source => { source.model.rootElements.find(item => item.id === 'Process').correlationSubscriptions[0].correlationPropertyBinding[0].correlationPropertyRef = { $ref: 'Order' }; },
  ];
  for (const [index, change] of cases.entries()) await t.test(String(index), async () => {
    const source = definition(true); change(source);
    assert.ok(validateWorkflowBpmn(await parseWorkflowBpmn(source)).some(issue => issue.code === 'message-correlation'));
  });
});

test('消息接收端点保留流程执行身份，恢复后的后继等待仍属于同一作用域', async () => {
  const model = await parseWorkflowBpmn(definition());
  let result = await advanceWorkflowBpmn(model, null, {});
  const start = result.activeActivities.find(item => item.nodeId === 'Start');
  assert.ok(start.processExecutionId);
  result = await advanceWorkflowBpmn(model, JSON.parse(JSON.stringify(result.checkpoint)), {}, [], [{ id: start.nodeId, executionId: start.executionId, workflowMessage: true, values: { tenant: 'one', order: 1 } }]);
  assert.equal(result.activeActivities.find(item => item.nodeId === 'Reply').processExecutionId, start.processExecutionId);
  const independent = await advanceWorkflowBpmn(model, null, {});
  assert.notEqual(independent.activeActivities[0].processExecutionId, start.processExecutionId);
  assert.deepEqual(model.definition, (await parseWorkflowBpmn(definition())).definition);
});

test('同一会话可以学习新键，但任何已初始化键的冲突都拒绝且不会改动旧快照', async () => {
  const source = definition();
  const roots = source.model.rootElements;
  roots.push({ $type: 'bpmn:CorrelationProperty', id: 'Shipment', correlationPropertyRetrievalExpression: [
    { $type: 'bpmn:CorrelationPropertyRetrievalExpression', messageRef: { $ref: 'Second' }, messagePath: { $type: 'bpmn:FormalExpression', language: KT_BPMN_EXPRESSION, body: '{"path":"content.shipment"}' } },
  ] });
  roots.find(item => item.id === 'Collaboration').correlationKeys.push({ $type: 'bpmn:CorrelationKey', id: 'ShipmentKey', correlationPropertyRef: [{ $ref: 'Shipment' }] });
  const model = await parseWorkflowBpmn(source);
  const initial = correlateBpmnMessage(model, 'Start', 'First', { tenant: '', order: 0 }, {}, {});
  const combined = correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: '', order: 0 }, shipment: { vendor: 'a', number: 1 } }, {}, initial, true);
  assert.deepEqual(combined.ShipmentKey, { Shipment: { vendor: 'a', number: 1 } });
  assert.equal(Object.hasOwn(initial, 'ShipmentKey'), false);
  assert.throws(() => correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: '', order: 0 }, shipment: { vendor: 'b', number: 1 } }, {}, combined, true), /不一致/);
  assert.deepEqual(correlateBpmnMessage(model, 'Reply', 'Second', { reply: { tenant: '', order: 0 }, shipment: { number: 1, vendor: 'a' } }, {}, combined, true), combined);
});

test('没有关联声明的消息仍可准确投递，但不能充当跨实例关联依据', async () => {
  const source = definition(); source.model.rootElements = source.model.rootElements.filter(item => item.id !== 'Collaboration');
  const model = await parseWorkflowBpmn(source);
  assert.deepEqual(correlateBpmnMessage(model, 'Start', 'First', { tenant: 'one', order: 1 }, {}, {}), {});
  assert.throws(() => correlateBpmnMessage(model, 'Start', 'First', { tenant: 'one', order: 1 }, {}, {}, true), /未声明/);
});

module.exports = { definition };
