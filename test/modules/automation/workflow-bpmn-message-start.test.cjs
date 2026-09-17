const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  parseWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  prepareBpmnMessageStart,
  businessMessageIngress,
  messageCorrelation,
} = require('../../../src/modules/workflow-engine/domain/workflow-message.policy');
const { definition } = require('./workflow-bpmn-correlation.test.cjs');

/**
 * 构造消息和空开始事件共存的流程，空入口指向独立人工任务用于侦测误启动。
 * @returns 保持纯 JSON 的最小消息启动模型。
 */
function messageStartDefinition() {
  const flow = (source, target) => ({
    $type: 'bpmn:SequenceFlow',
    id: source + '_' + target,
    sourceRef: { $ref: source },
    targetRef: { $ref: target },
  });
  const human = (id) => ({
    $type: 'bpmn:UserTask',
    id,
    extensionElements: {
      $type: 'bpmn:ExtensionElements',
      values: [
        {
          $type: 'kt:Step',
          body: '{"kind":"human","formRef":null,"writableFields":[],"input":{}}',
        },
      ],
    },
  });
  return {
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions',
      id: 'Definitions',
      targetNamespace: 'urn:kt:message-start',
      rootElements: [
        { $type: 'bpmn:Message', id: 'Begin' },
        {
          $type: 'bpmn:Process',
          id: 'Process',
          isExecutable: true,
          flowElements: [
            { $type: 'bpmn:StartEvent', id: 'Empty' },
            {
              $type: 'bpmn:StartEvent',
              id: 'MessageStart',
              eventDefinitions: [
                {
                  $type: 'bpmn:MessageEventDefinition',
                  messageRef: { $ref: 'Begin' },
                },
              ],
            },
            human('Unwanted'),
            human('Wanted'),
            { $type: 'bpmn:EndEvent', id: 'End' },
            flow('Empty', 'Unwanted'),
            flow('Unwanted', 'End'),
            flow('MessageStart', 'Wanted'),
            flow('Wanted', 'End'),
          ],
        },
      ],
    },
  };
}

test('首条消息仅准备选中的启动组，空入口不产生任务且跨恢复不复活', async () => {
  const model = await parseWorkflowBpmn(messageStartDefinition());
  let result = await advanceWorkflowBpmn(model, null, {}, [], [], {
    processId: 'Process',
    entryId: 'MessageStart',
  });
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(
    result.activeActivities.map((item) => item.nodeId),
    ['MessageStart'],
  );
  const start = result.activeActivities[0];
  result = await advanceWorkflowBpmn(
    model,
    JSON.parse(JSON.stringify(result.checkpoint)),
    {},
    [],
    [
      {
        id: start.nodeId,
        executionId: start.executionId,
        workflowMessage: true,
        values: {},
      },
    ],
  );
  assert.deepEqual(
    result.jobs.map((item) => item.elementId),
    ['Wanted'],
  );
  assert.equal(
    result.transitions.some(
      (item) =>
        item.elementId === 'Unwanted' && item.event === 'activity.enter',
    ),
    false,
  );
});

module.exports = { messageStartDefinition };

test('业务投递摘要忽略字段顺序，区分对象和发送方并拒绝非法正文', () => {
  const message = {
    deliveryId: 'd1',
    senderId: 'adapter',
    messageId: 'First',
    values: { b: 2, a: 1 },
  };
  const original = businessMessageIngress(message, [
    'business',
    'scope',
    'object',
  ]);
  assert.deepEqual(
    original,
    businessMessageIngress({ ...message, values: { a: 1, b: 2 } }, [
      'business',
      'scope',
      'object',
    ]),
  );
  assert.notEqual(
    original.ingressKey,
    businessMessageIngress(message, ['business', 'scope', 'other']).ingressKey,
  );
  assert.notEqual(
    original.ingressKey,
    businessMessageIngress({ ...message, senderId: 'other' }, [
      'business',
      'scope',
      'object',
    ]).ingressKey,
  );
  assert.throws(
    () =>
      businessMessageIngress(
        { ...message, values: { text: 'x'.repeat(65536) } },
        [],
      ),
    /64 KiB/,
  );
  assert.throws(() =>
    businessMessageIngress({ ...message, values: { number: NaN } }, []),
  );
  assert.throws(
    () =>
      businessMessageIngress(
        { ...message, values: JSON.parse('{"__proto__":1}') },
        [],
      ),
    /原型/,
  );
});

test('首消息准备同时包含等待快照、投递回执与作用域关联，恢复只推进所选流程', async () => {
  const source = definition(true);
  source.model.rootElements.push({
    $type: 'bpmn:Process',
    id: 'OtherProcess',
    isExecutable: true,
    flowElements: [
      { $type: 'bpmn:StartEvent', id: 'OtherStart' },
      { $type: 'bpmn:EndEvent', id: 'OtherEnd' },
      {
        $type: 'bpmn:SequenceFlow',
        id: 'OtherFlow',
        sourceRef: { $ref: 'OtherStart' },
        targetRef: { $ref: 'OtherEnd' },
      },
    ],
  });
  const model = await parseWorkflowBpmn(source);
  const input = { tenant: 'tenant', order: 'alpha' };
  const message = businessMessageIngress(
    {
      deliveryId: 'first',
      senderId: 'sender',
      messageId: 'First',
      values: input,
    },
    ['business', 'object'],
  );
  const state = await prepareBpmnMessageStart(model, input, message);
  assert.equal(state.messages.length, 1);
  assert.deepEqual(state.messages[0].correlation.keys.OrderKey, {
    Tenant: 'tenant',
    Order: 'alpha',
  });
  assert.equal(
    state.transitions.some((item) => item.elementId === 'OtherStart'),
    false,
  );
  const queued = state.messages[0];
  const next = await advanceWorkflowBpmn(
    model,
    JSON.parse(JSON.stringify(state.checkpoint)),
    {},
    [],
    [
      {
        id: queued.nodeId,
        executionId: queued.executionId,
        workflowMessage: true,
        values: queued.values,
      },
    ],
  );
  assert.deepEqual(
    next.activeActivities.map((item) => item.nodeId),
    ['Reply'],
  );
  const waiting = next.activeActivities[0];
  const restored = {
    ...state,
    activeActivities: next.activeActivities,
    checkpoint: next.checkpoint,
    messages: [],
    correlations: {
      [queued.correlation.processExecutionId]: queued.correlation.keys,
    },
  };
  assert.ok(
    messageCorrelation(
      model,
      restored,
      waiting,
      { messageId: 'Second', values: { reply: input } },
      input,
      true,
    ),
  );
  assert.throws(
    () =>
      messageCorrelation(
        model,
        restored,
        waiting,
        {
          messageId: 'Second',
          values: { reply: { ...input, order: 'wrong' } },
        },
        input,
        true,
      ),
    /关联键/,
  );
});

test('消息启动拒绝不完整关联、错误类型和同类型歧义入口', async () => {
  const model = await parseWorkflowBpmn(definition(true));
  const input = { tenant: 'tenant', order: 'alpha' };
  const message = businessMessageIngress(
    {
      deliveryId: 'first',
      senderId: 'sender',
      messageId: 'First',
      values: input,
    },
    [],
  );
  await assert.rejects(
    prepareBpmnMessageStart(model, input, {
      ...message,
      values: { tenant: 'tenant' },
    }),
    /唯一/,
  );
  await assert.rejects(
    prepareBpmnMessageStart(model, input, { ...message, messageId: 'Second' }),
    /唯一/,
  );
  const ambiguous = messageStartDefinition();
  const process = ambiguous.model.rootElements.find(
    (item) => item.id === 'Process',
  );
  process.flowElements.find((item) => item.id === 'Empty').eventDefinitions = [
    { $type: 'bpmn:MessageEventDefinition', messageRef: { $ref: 'Begin' } },
  ];
  await assert.rejects(
    prepareBpmnMessageStart(
      await parseWorkflowBpmn(ambiguous),
      {},
      { ...message, messageId: 'Begin' },
    ),
    /唯一/,
  );
});

test('实例化接收任务能准备首条消息并原样保存 JSON', async () => {
  const source = messageStartDefinition();
  const start = source.model.rootElements
    .find((item) => item.id === 'Process')
    .flowElements.find((item) => item.id === 'MessageStart');
  start.$type = 'bpmn:ReceiveTask';
  start.instantiate = true;
  start.messageRef = { $ref: 'Begin' };
  delete start.eventDefinitions;
  const model = await parseWorkflowBpmn(source);
  const message = businessMessageIngress(
    { deliveryId: 'first', senderId: 'sender', messageId: 'Begin', values: {} },
    [],
  );
  const state = await prepareBpmnMessageStart(model, {}, message);
  assert.equal(state.messages[0].nodeId, 'MessageStart');
  assert.equal(state.checkpoint.messageStart.entryId, 'MessageStart');
  assert.deepEqual(model.definition, source);
});

test('并行实例化网关首消息只消费一个等待，剩余消息在同组恢复后继续关联', async () => {
  const source = definition(true);
  const process = source.model.rootElements.find(
    (item) => item.id === 'Process',
  );
  const start = process.flowElements.find((item) => item.id === 'Start');
  start.$type = 'bpmn:EventBasedGateway';
  start.instantiate = true;
  start.eventGatewayType = 'Parallel';
  delete start.eventDefinitions;
  process.flowElements.push(
    {
      $type: 'bpmn:IntermediateCatchEvent',
      id: 'FirstWait',
      eventDefinitions: [
        { $type: 'bpmn:MessageEventDefinition', messageRef: { $ref: 'First' } },
      ],
    },
    {
      $type: 'bpmn:SequenceFlow',
      id: 'Start_FirstWait',
      sourceRef: { $ref: 'Start' },
      targetRef: { $ref: 'FirstWait' },
    },
    {
      $type: 'bpmn:SequenceFlow',
      id: 'FirstWait_End',
      sourceRef: { $ref: 'FirstWait' },
      targetRef: { $ref: 'End' },
    },
  );
  source.model.rootElements
    .find((item) => item.id === 'Collaboration')
    .messageFlows.find((item) => item.id === 'FirstFlow').targetRef = {
    $ref: 'FirstWait',
  };
  const model = await parseWorkflowBpmn(source);
  const input = { tenant: 'tenant', order: 'alpha' };
  const message = businessMessageIngress(
    {
      deliveryId: 'first',
      senderId: 'sender',
      messageId: 'First',
      values: input,
    },
    [],
  );
  const state = await prepareBpmnMessageStart(model, input, message);
  assert.equal(state.checkpoint.messageStart.entryId, 'Start');
  assert.deepEqual(state.activeActivities.map((item) => item.nodeId).sort(), [
    'FirstWait',
    'Reply',
  ]);
  const queued = state.messages[0];
  const result = await advanceWorkflowBpmn(
    model,
    JSON.parse(JSON.stringify(state.checkpoint)),
    {},
    [],
    [
      {
        id: queued.nodeId,
        executionId: queued.executionId,
        workflowMessage: true,
        values: queued.values,
      },
    ],
  );
  assert.equal(result.status, 'waiting');
  assert.deepEqual(
    result.activeActivities.map((item) => item.nodeId),
    ['Reply'],
  );
  assert.ok(
    messageCorrelation(
      model,
      state,
      result.activeActivities[0],
      { messageId: 'Second', values: { reply: input } },
      input,
      true,
    ),
  );
});
